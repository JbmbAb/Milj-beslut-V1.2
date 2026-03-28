#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


RISKY_LINK_DOMAINS = (
    "sharepoint.com",
    "my.sharepoint.com",
    "1drv.ms",
    "onedrive.live.com",
    "dropbox.com",
    "box.com",
    "wetransfer.com",
    "sprend.com",
    "filemail.com",
    "transfernow.net",
)

SUBJECT_PATTERNS = {
    "fee": re.compile(r"\b(avgift|faktura|kostnad|debiter|betal)\b", re.I),
    "password": re.compile(r"\b(losenord|lösenord|password|kod)\b", re.I),
    "reply": re.compile(r"\b(aterkoppla|återkoppla|bekrafta|bekräfta|mottagit|mottaget|saknas|behover du|behöver du|fraga|fråga)\b", re.I),
    "referral": re.compile(r"\b(hanvis|hänvis|vidarebeford|overlamnat|överlämnat|annan myndighet)\b", re.I),
    "no_cases": re.compile(r"\b(inga arenden|inga ärenden|inga handlingar|finns inga|saknar arenden|saknar ärenden)\b", re.I),
    "deadline": re.compile(r"\b(senast|giltig till|expires?|utgar|utgår|sista dag)\b", re.I),
    "autoreply": re.compile(r"\b(tack for att du kontaktat oss|tack för att du kontaktat oss|tack for ditt e-postmeddelande|tack för ditt e-postmeddelande|tack for ditt mail|tack för ditt mail|tack for ditt mejl|tack för ditt mejl|automatic reply|autosvar|automatiskt svar|franvaro|frånvaro|out of office)\b", re.I),
}

GENERIC_MAILBOX_KEYWORDS = (
    "info",
    "kontakt",
    "kontaktcenter",
    "kundcenter",
    "kundtjanst",
    "servicecenter",
    "kommun",
    "kommunen",
    "registrator",
    "diarium",
    "miljo",
    "miljokontoret",
    "miljoavdelningen",
    "miljoskydd",
    "miljoforvaltningen",
    "byggmiljo",
    "samhallsbyggnad",
    "kommunstyrelsen",
    "mhn",
    "mb",
)

BUCKET_ORDER = {
    "P1-Akut": 1,
    "P2-Handlaggardialog": 2,
    "P3-MaterialMottaget": 3,
    "P4-HanvisningEllerIngaArenden": 4,
    "P5-Avvikande": 5,
}


def read_semicolon_dicts(path: Path) -> List[Dict[str, str]]:
    last_exc: Exception = RuntimeError("No encoding succeeded")
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                return list(csv.DictReader(handle, delimiter=";"))
        except UnicodeDecodeError as exc:
            last_exc = exc
    raise last_exc


def write_semicolon_dicts(path: Path, rows: List[Dict[str, str]], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter=";", quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)


def normalize_bool(value: str) -> bool:
    return (value or "").strip().upper() == "TRUE"


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def extract_domain(email: str) -> str:
    if "@" not in email:
        return ""
    return email.split("@", 1)[1].lower()


def local_part(email: str) -> str:
    return email.split("@", 1)[0].lower() if "@" in email else ""


def is_generic_mailbox(email: str) -> bool:
    lp = re.sub(r"[^a-z0-9]+", "", local_part(email))
    if not lp:
        return True
    return any(keyword in lp for keyword in GENERIC_MAILBOX_KEYWORDS)


def has_risky_link(domains: str) -> bool:
    value = (domains or "").lower()
    return any(domain in value for domain in RISKY_LINK_DOMAINS)


def match_signal(name: str, subject: str) -> bool:
    return bool(SUBJECT_PATTERNS[name].search(subject or ""))


def sender_class(contact_row: Dict[str, str] | None, sender_email: str) -> str:
    if not sender_email:
        return "okand"
    if contact_row:
        entity_type = contact_row.get("EntityType", "")
        source_types = set(filter(None, (contact_row.get("SourceTypes", "") or "").split(";")))
        if entity_type == "Kommun":
            if ("manifest_sender" in source_types or "triage_sender" in source_types) and not is_generic_mailbox(sender_email):
                return "handlaggare"
            if is_generic_mailbox(sender_email):
                return "registrator_eller_funktionsbrevlada"
            return "kommunkontakt"
        if entity_type == "Lansstyrelse":
            return "lansstyrelse"
        if entity_type == "Domstol":
            return "domstol"
    return "okand"


def classify_bucket(row: Dict[str, str], contact_row: Dict[str, str] | None, manifest_row: Dict[str, str] | None) -> Tuple[str, List[str], int]:
    reasons: List[str] = []
    subject = row.get("Subject", "") or (manifest_row or {}).get("subject", "")
    sender_email = normalize_email(row.get("SenderEmail", "") or (manifest_row or {}).get("sender", ""))
    source_types = set(filter(None, ((contact_row or {}).get("SourceTypes", "") or "").split(";")))
    risky_link = has_risky_link(row.get("ExternalLinkDomain", ""))
    has_link = int(row.get("LinkCount", "0") or "0") > 0
    has_attachments = normalize_bool(row.get("HasAttachments", ""))
    fee = match_signal("fee", subject)
    needs_reply = match_signal("reply", subject)
    deadline = match_signal("deadline", subject)
    expired_risk = risky_link and (normalize_bool(row.get("ExpiredRisk", "")) or deadline)
    password = match_signal("password", subject)
    referral = match_signal("referral", subject)
    no_cases = match_signal("no_cases", subject)
    autoreply = match_signal("autoreply", subject)

    # Body Analysis (if available)
    body = (manifest_row or {}).get("body_preview", "").lower()
    if body:
        if not referral and match_signal("referral", body):
            referral = True
            reasons.append("hanvisning_i_body")
        if not no_cases and match_signal("no_cases", body):
            no_cases = True
            reasons.append("inga_arenden_i_body")
        if not fee and match_signal("fee", body):
            fee = True
            reasons.append("avgift_i_body")
        if not password and match_signal("password", body):
            password = True
            reasons.append("losenord_i_body")
        if not needs_reply and match_signal("reply", body):
            needs_reply = True
            reasons.append("aterkoppling_i_body")

    anomaly_reason = (contact_row or {}).get("ExcludeReason", "")
    if anomaly_reason:
        reasons.append(anomaly_reason)
        score = 500 + int(row.get("PriorityScore", "0") or "0")
        return "P5-Avvikande", reasons, score

    sender_kind = sender_class(contact_row, sender_email)
    if autoreply and not risky_link and not fee and not password:
        reasons.append("autosvar_eller_tack")
        return "P5-Avvikande", reasons, 520

    if referral or no_cases:
        if referral:
            reasons.append("hanvisning")
        if no_cases:
            reasons.append("inga_arenden")
        return "P4-HanvisningEllerIngaArenden", reasons, 400

    if risky_link:
        reasons.append("riskabel_lank")
    if expired_risk:
        reasons.append("expired_risk")
    if deadline:
        reasons.append("deadline_eller_tidskansligt")
    if fee:
        reasons.append("avgift")
    if password:
        reasons.append("losenord")
    if needs_reply:
        reasons.append("aterkoppling")

    if risky_link or expired_risk or fee or password or needs_reply or deadline:
        score = 100
        score -= 20 if risky_link else 0
        score -= 15 if expired_risk else 0
        score -= 10 if fee else 0
        score -= 10 if password else 0
        score -= 8 if needs_reply else 0
        score -= 6 if deadline else 0
        score -= 4 if sender_kind == "handlaggare" else 0
        return "P1-Akut", reasons, score

    if sender_kind == "handlaggare":
        reasons.append("handlaggare_i_areendedialog")
        score = 200 - int(row.get("PriorityScore", "0") or "0")
        return "P2-Handlaggardialog", reasons, score

    if has_attachments or has_link:
        if has_attachments:
            reasons.append("har_bilaga")
        if has_link:
            reasons.append("har_lank")
        return "P3-MaterialMottaget", reasons, 300 - int(row.get("PriorityScore", "0") or "0")

    if sender_kind in {"registrator_eller_funktionsbrevlada", "kommunkontakt", "lansstyrelse", "domstol"}:
        reasons.append(sender_kind)
        return "P2-Handlaggardialog", reasons, 250

    reasons.append("oklassad")
    return "P5-Avvikande", reasons, 550


def generate_draft_response(bucket: str, reasons: List[str], municipality: str) -> str:
    if bucket == "P1-Akut":
        if "avgift" in "".join(reasons):
            return f"Hej {municipality}, tack för svar. Jag godkänner avgiften, vänligen skicka handlingarna."
        if "losenord" in "".join(reasons):
            return f"Hej {municipality}, tack för svar. Vänligen återkom med lösenordet så att jag kan läsa filerna."
        if "riskabel_lank" in "".join(reasons):
            return f"Hej {municipality}, tack för info. Jag har svårt att nå länken, går det att skicka som bilaga istället?"
        return f"Hej {municipality}, tack för återkoppling. Jag tittar på detta nu."
    if bucket == "P2-Handlaggardialog":
        return f"Hej, tack för ditt svar och för hjälpen med materialet i {municipality}! Vi går igenom detta nu."
    if bucket == "P4-HanvisningEllerIngaArenden":
        if "inga_arenden" in "".join(reasons):
            return f"Hej, tack för att ni kollat. Vi noterar att ni inte har några sådana ärenden just nu."
        return f"Hej, tack för hänvisningen. Jag vänder mig till rätt instans."
    return ""


def operational_action(bucket: str) -> str:
    return {
        "P1-Akut": "Sakra lankar, hantera avgift/losenord och svara samma dag",
        "P2-Handlaggardialog": "Svara kort och personligt, hall dialogen varm",
        "P3-MaterialMottaget": "Registrera material och koppla till kommun/arende",
        "P4-HanvisningEllerIngaArenden": "Logga utfallet och skapa ev. uppfoljning mot ny instans",
        "P5-Avvikande": "Flytta ur huvudflodet och manuellt bedom om exkludering",
    }[bucket]


def main() -> None:
    parser = argparse.ArgumentParser(description="Operationally sort Outlook backlog into actionable buckets.")
    parser.add_argument("--triage-csv", default=r"C:\Users\jimmy\Desktop\OutlookExport\outlook_email_triage_report.csv")
    parser.add_argument("--manifest-csv", default=r"C:\Users\jimmy\Desktop\OutlookExport\manifest.csv")
    parser.add_argument("--contact-master-csv", default=r"C:\Users\jimmy\Desktop\OutlookExport\framtida_utskickslista_master.csv")
    parser.add_argument("--output-dir", default=r"C:\Users\jimmy\Desktop\OutlookExport")
    args = parser.parse_args()

    triage_rows = read_semicolon_dicts(Path(args.triage_csv))
    manifest_rows = read_semicolon_dicts(Path(args.manifest_csv))
    contact_rows = read_semicolon_dicts(Path(args.contact_master_csv))
    output_dir = Path(args.output_dir)

    manifest_by_id = {row.get("message_id", ""): row for row in manifest_rows if row.get("message_id")}
    contact_by_email = {normalize_email(row.get("Email", "")): row for row in contact_rows if row.get("Email")}

    enriched: List[Dict[str, str]] = []
    bucket_counter: Counter[str] = Counter()

    for row in triage_rows:
        manifest_row = manifest_by_id.get(row.get("EntryID", ""))
        sender_email = normalize_email(row.get("SenderEmail", "") or (manifest_row or {}).get("sender", ""))
        contact_row = contact_by_email.get(sender_email)
        bucket, reasons, rank = classify_bucket(row, contact_row, manifest_row)
        bucket_counter[bucket] += 1
        manifest_kommun = (manifest_row or {}).get("kommunnamn", "")
        resolved_kommun = manifest_kommun or ((contact_row or {}).get("EntityName", "") if (contact_row or {}).get("EntityType", "") == "Kommun" else "")

        enriched_row = dict(row)
        enriched_row["ResolvedSenderEmail"] = sender_email
        enriched_row["ResolvedMunicipality"] = resolved_kommun
        enriched_row["SenderClass"] = sender_class(contact_row, sender_email)
        enriched_row["ContactEntityType"] = (contact_row or {}).get("EntityType", "")
        enriched_row["ContactEntityName"] = (contact_row or {}).get("EntityName", "")
        enriched_row["ContactRoleResolved"] = (contact_row or {}).get("ContactRole", "")
        enriched_row["ContactSourceTypes"] = (contact_row or {}).get("SourceTypes", "")
        enriched_row["OperationalBucket"] = bucket
        enriched_row["OperationalReason"] = ";".join(reasons)
        enriched_row["OperationalAction"] = operational_action(bucket)
        enriched_row["OperationalRank"] = str(rank)
        enriched_row["DraftResponse"] = generate_draft_response(bucket, reasons, resolved_kommun or "Kommunen")
        enriched.append(enriched_row)

    enriched.sort(
        key=lambda row: (
            BUCKET_ORDER.get(row["OperationalBucket"], 9),
            int(row["OperationalRank"]),
            -(int(row.get("PriorityScore", "0") or "0")),
            row.get("ReceivedTime", ""),
        )
    )

    fieldnames = list(enriched[0].keys()) if enriched else []
    main_output = output_dir / "outlook_backlog_operativ_sortering.csv"
    write_semicolon_dicts(main_output, enriched, fieldnames)

    bucket_to_filename = {
        "P1-Akut": "outlook_backlog_p1_akut.csv",
        "P2-Handlaggardialog": "outlook_backlog_p2_handlaggardialog.csv",
        "P3-MaterialMottaget": "outlook_backlog_p3_material_mottaget.csv",
        "P4-HanvisningEllerIngaArenden": "outlook_backlog_p4_hanvisning_inga_arenden.csv",
        "P5-Avvikande": "outlook_backlog_p5_avvikande.csv",
    }
    for bucket, filename in bucket_to_filename.items():
        rows = [row for row in enriched if row["OperationalBucket"] == bucket]
        write_semicolon_dicts(output_dir / filename, rows, fieldnames)

    print(f"TOTAL={len(enriched)}")
    for bucket in sorted(bucket_counter.keys(), key=lambda b: BUCKET_ORDER.get(b, 9)):
        print(f"{bucket}={bucket_counter[bucket]}")
    print(f"OUTPUT={main_output}")


if __name__ == "__main__":
    main()
