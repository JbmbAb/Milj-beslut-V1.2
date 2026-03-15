#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple
from urllib.parse import urlparse


EXCLUDED_DOMAINS = {
    "brilliantnavigator.com",
    "sprend.com",
    "rukkor.com",
    "westudents.se",
    "wikells.se",
    "email.openai.com",
}

NOREPLY_PREFIXES = (
    "noreply",
    "no-reply",
    "donotreply",
    "do-not-reply",
    "no_reply",
)

GENERIC_MAILBOX_KEYWORDS = (
    "info",
    "kontakt",
    "kontaktcenter",
    "kundcenter",
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


def normalize_text(value: str) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", ascii_only.lower())


def normalize_email(value: str) -> str:
    email = (value or "").strip().lower()
    email = email.strip("<>").replace("mailto:", "")
    return email


def looks_like_email(value: str) -> bool:
    return bool(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", normalize_email(value)))


def read_semicolon_rows(path: Path) -> List[List[str]]:
    last_error: Optional[Exception] = None
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                return list(csv.reader(handle, delimiter=";"))
        except UnicodeDecodeError as exc:
            last_error = exc
    raise RuntimeError(f"Could not decode {path}") from last_error


def read_semicolon_dicts(path: Path) -> List[Dict[str, str]]:
    rows = read_semicolon_rows(path)
    if not rows:
        return []
    header = rows[0]
    data: List[Dict[str, str]] = []
    for raw_row in rows[1:]:
        row = list(raw_row)
        if len(row) < len(header):
            row.extend([""] * (len(header) - len(row)))
        elif len(row) > len(header):
            row = row[: len(header)]
        data.append(dict(zip(header, row)))
    return data


def extract_domain(email: str) -> str:
    if "@" not in email:
        return ""
    return email.split("@", 1)[1].lower()


def local_part(email: str) -> str:
    return email.split("@", 1)[0].lower() if "@" in email else ""


def load_manual_list(path: Path) -> Tuple[Set[str], Set[str]]:
    emails: Set[str] = set()
    domains: Set[str] = set()
    if not path.exists():
        return emails, domains
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("domain:"):
            domains.add(line.split(":", 1)[1].strip().lower())
        elif "@" in line:
            emails.add(normalize_email(line))
        else:
            domains.add(line.lower())
    return emails, domains


def extract_host(url: str) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def strip_municipality_suffix(name: str) -> str:
    value = normalize_text(name)
    for suffix in ("kommun", "stad", "regiongotland"):
        if value.endswith(suffix):
            return value[: -len(suffix)]
    return value


def pretty_municipality_name(name: str) -> str:
    if not name:
        return ""
    stripped = name.strip()
    if normalize_text(stripped).endswith("kommun") or normalize_text(stripped).endswith("stad"):
        return stripped
    if normalize_text(stripped) == "regiongotland":
        return "Region Gotland"
    return f"{stripped} kommun"


class MunicipalityDirectory:
    def __init__(self) -> None:
        self.by_norm_name: Dict[str, Dict[str, str]] = {}
        self.domain_to_muni: Dict[str, Dict[str, str]] = {}
        self.alias_to_muni: Dict[str, Dict[str, str]] = {}
        self.email_to_role: Dict[str, Tuple[Dict[str, str], str]] = {}

    def load(self, path: Path) -> None:
        rows = read_semicolon_rows(path)
        for row in rows[1:]:
            if len(row) < 8:
                continue
            code = row[0].strip()
            name = row[3].strip()
            primary_email = normalize_email(row[4].strip() if len(row) > 4 else "")
            secondary_email = normalize_email(row[5].strip() if len(row) > 5 else "")
            website = row[7].strip() if len(row) > 7 else ""
            if not name:
                continue
            record = {
                "EntityName": name,
                "EntityCode": code,
                "EntityType": "Kommun",
            }
            norm_name = normalize_text(name)
            self.by_norm_name[norm_name] = record
            aliases = {
                norm_name,
                strip_municipality_suffix(name),
            }
            for alias in list(aliases):
                if alias.endswith("s") and len(alias) > 3:
                    aliases.add(alias[:-1])
            for alias in aliases:
                if alias:
                    self.alias_to_muni.setdefault(alias, record)
            for email, role in ((primary_email, "Miljo_eller_registrator"), (secondary_email, "Central_e_post")):
                if looks_like_email(email):
                    self.email_to_role[email] = (record, role)
                    domain = extract_domain(email)
                    if domain:
                        self.domain_to_muni.setdefault(domain, record)
            host = extract_host(website)
            if host:
                self.domain_to_muni.setdefault(host, record)
                first_label = host.split(".", 1)[0]
                if first_label:
                    self.alias_to_muni.setdefault(normalize_text(first_label), record)

    def classify_email(self, email: str, manifest_names: Iterable[str]) -> Tuple[str, str, str, str]:
        email = normalize_email(email)
        if not looks_like_email(email):
            return "", "", "Okand", ""

        official = self.email_to_role.get(email)
        if official:
            record, role = official
            return record["EntityName"], record["EntityCode"], record["EntityType"], role

        manifest_candidates = [name for name in manifest_names if name]
        if len(manifest_candidates) == 1:
            norm = normalize_text(manifest_candidates[0])
            record = self.by_norm_name.get(norm) or self.alias_to_muni.get(norm)
            if record:
                return record["EntityName"], record["EntityCode"], record["EntityType"], "Svarsavsandare"

        domain = extract_domain(email)
        record = self.domain_to_muni.get(domain)
        if record:
            return record["EntityName"], record["EntityCode"], record["EntityType"], "Svarsavsandare"

        if domain.endswith(".mail.onmicrosoft.com"):
            prefix = domain[: -len(".mail.onmicrosoft.com")]
            record = self.alias_to_muni.get(normalize_text(prefix))
            if record:
                return record["EntityName"], record["EntityCode"], record["EntityType"], "Svarsavsandare"

        if "lansstyrelsen" in domain or domain.endswith(".lst.se"):
            return "Lansstyrelse", "", "Lansstyrelse", "Myndighetskontakt"

        if domain.endswith(".dom.se") or "domstol" in domain:
            return "Domstol", "", "Domstol", "Myndighetskontakt"

        return "", "", "Okand", "Svarsavsandare"


def load_extra_official_contacts(path: Path, source_type: str) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    rows = read_semicolon_dicts(path)
    output: List[Dict[str, str]] = []
    for row in rows:
        email = normalize_email(row.get("Email", ""))
        if not looks_like_email(email):
            continue
        output.append(
            {
                "Email": email,
                "EntityName": row.get("EntityName", "").strip(),
                "EntityCode": row.get("EntityCode", "").strip(),
                "EntityType": row.get("EntityType", "").strip() or "Okand",
                "ContactRole": row.get("ContactRole", "").strip() or "Myndighetskontakt",
                "ClassificationSource": row.get("ClassificationSource", "").strip() or source_type,
                "SourceType": source_type,
            }
        )
    return output


def initial_entity_name(email: str) -> str:
    domain = extract_domain(email)
    if domain.endswith(".mail.onmicrosoft.com"):
        return domain.replace(".mail.onmicrosoft.com", "")
    if domain:
        return domain.split(".", 1)[0]
    return ""


def exclusion_reason(
    email: str,
    entity_type: str,
    whitelist_emails: Set[str],
    whitelist_domains: Set[str],
    blacklist_emails: Set[str],
    blacklist_domains: Set[str],
) -> str:
    local_part = email.split("@", 1)[0].lower()
    domain = extract_domain(email)
    if email in whitelist_emails or domain in whitelist_domains:
        return ""
    if email in blacklist_emails or domain in blacklist_domains:
        return "manual_blacklist"
    if any(local_part.startswith(prefix) for prefix in NOREPLY_PREFIXES):
        return "noreply_or_bulk_sender"
    if domain in EXCLUDED_DOMAINS:
        return "excluded_domain"
    if domain.endswith("onmicrosoft.com") and entity_type == "Kommun":
        return ""
    if domain and not domain.endswith(".se") and not domain.endswith(".dom.se"):
        return "non_se_domain"
    return ""


def is_generic_mailbox(email: str) -> bool:
    lp = normalize_text(local_part(email))
    if not lp:
        return True
    return any(keyword in lp for keyword in GENERIC_MAILBOX_KEYWORDS)


def preferred_contact_rank(row: Dict[str, str]) -> Tuple[int, int, int, str]:
    source_types = set(filter(None, row.get("SourceTypes", "").split(";")))
    manifest_count = int(row.get("ManifestCount", "0") or "0")
    triage_count = int(row.get("TriageCount", "0") or "0")
    activity = manifest_count + triage_count
    generic = is_generic_mailbox(row.get("Email", ""))

    if "manifest_sender" in source_types or "triage_sender" in source_types:
        if not generic:
            return (0, -activity, 0, row.get("Email", ""))
        return (2, -activity, 0, row.get("Email", ""))
    if "official_primary" in source_types:
        return (1, 0, 0, row.get("Email", ""))
    if "official_secondary" in source_types:
        return (3, 0, 0, row.get("Email", ""))
    return (4, 0, 0, row.get("Email", ""))


def selection_reason(row: Dict[str, str]) -> str:
    source_types = set(filter(None, row.get("SourceTypes", "").split(";")))
    if "manifest_sender" in source_types or "triage_sender" in source_types:
        if not is_generic_mailbox(row.get("Email", "")):
            return "prioriterad_handlaggare_fran_areendedialog"
        return "prioriterad_funktionslada_fran_areendedialog"
    if "official_primary" in source_types:
        return "officiell_primarkontakt"
    if "official_secondary" in source_types:
        return "officiell_sekundarkontakt"
    return "manuell_bedomning"


def build_preferred_contact_rows(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    by_entity: Dict[Tuple[str, str], List[Dict[str, str]]] = defaultdict(list)
    for row in rows:
        key = (row.get("EntityCode", ""), row.get("EntityName", ""))
        by_entity[key].append(row)

    preferred_rows: List[Dict[str, str]] = []
    for (entity_code, entity_name), group in sorted(by_entity.items(), key=lambda item: normalize_text(item[0][1])):
        chosen = sorted(group, key=preferred_contact_rank)[0]
        official_primary = next((r["Email"] for r in group if "official_primary" in r.get("SourceTypes", "").split(";")), "")
        official_secondary = next((r["Email"] for r in group if "official_secondary" in r.get("SourceTypes", "").split(";")), "")
        preferred_rows.append(
            {
                "EntityCode": entity_code,
                "EntityName": entity_name,
                "EntityType": chosen.get("EntityType", ""),
                "PreferredEmail": chosen.get("Email", ""),
                "PreferredContactRole": chosen.get("ContactRole", ""),
                "PreferredSourceTypes": chosen.get("SourceTypes", ""),
                "PreferredClassificationSource": chosen.get("ClassificationSource", ""),
                "ManifestCount": chosen.get("ManifestCount", "0"),
                "TriageCount": chosen.get("TriageCount", "0"),
                "SelectionReason": selection_reason(chosen),
                "OfficialPrimaryEmail": official_primary,
                "OfficialSecondaryEmail": official_secondary,
                "AllCandidateEmails": ";".join(sorted(r["Email"] for r in group)),
                "CandidateCount": str(len(group)),
            }
        )
    return preferred_rows


def anomaly_sort_key(row: Dict[str, str]) -> Tuple[int, int, int, str]:
    reason = row.get("ExcludeReason", "")
    reason_rank = {
        "manual_review_unknown_entity": 0,
        "manual_blacklist": 1,
        "non_se_domain": 2,
        "excluded_domain": 3,
        "noreply_or_bulk_sender": 4,
    }
    manifest_count = int(row.get("ManifestCount", "0") or "0")
    triage_count = int(row.get("TriageCount", "0") or "0")
    activity = manifest_count + triage_count
    return (
        reason_rank.get(reason, 9),
        -activity,
        0 if row.get("SeenInManifest") == "True" or row.get("SeenInTriage") == "True" else 1,
        row.get("Email", ""),
    )


def mailout_tier(source_types: Iterable[str]) -> str:
    source_set = set(source_types)
    if "official_primary" in source_set:
        return "official_primary"
    if "official_secondary" in source_set:
        return "official_secondary"
    return "response_sender"


def sort_rows(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    tier_order = {
        "official_primary": 0,
        "official_secondary": 1,
        "response_sender": 2,
        "exclude": 9,
    }
    return sorted(
        rows,
        key=lambda row: (
            tier_order.get(row.get("MailoutTier", ""), 8),
            row.get("EntityType", ""),
            normalize_text(row.get("EntityName", "")),
            row.get("Email", ""),
        ),
    )


def write_csv(path: Path, rows: List[Dict[str, str]], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter=";", quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build future Outlook mailout lists from official contacts and Outlook exports.")
    parser.add_argument(
        "--official-contact-csv",
        default=r"C:\Users\jimmy\Desktop\Examens arbete\Excel\Kontaktuppgifter kommuner och region Gotland.csv",
    )
    parser.add_argument(
        "--manifest-csv",
        default=r"C:\Users\jimmy\Desktop\OutlookExport\manifest.csv",
    )
    parser.add_argument(
        "--triage-csv",
        default=r"C:\Users\jimmy\Desktop\OutlookExport\outlook_email_triage_report.csv",
    )
    parser.add_argument(
        "--output-dir",
        default=r"C:\Users\jimmy\Desktop\OutlookExport",
    )
    parser.add_argument(
        "--lansstyrelser-csv",
        default="scripts/outlook/official_lansstyrelser.csv",
    )
    parser.add_argument(
        "--domstolar-csv",
        default="scripts/outlook/official_mark_och_miljodomstolar.csv",
    )
    parser.add_argument(
        "--whitelist-file",
        default="scripts/outlook/mailout_whitelist.txt",
    )
    parser.add_argument(
        "--blacklist-file",
        default="scripts/outlook/mailout_blacklist.txt",
    )
    args = parser.parse_args()

    official_csv = Path(args.official_contact_csv)
    manifest_csv = Path(args.manifest_csv)
    triage_csv = Path(args.triage_csv)
    output_dir = Path(args.output_dir)
    lansstyrelser_csv = Path(args.lansstyrelser_csv)
    domstolar_csv = Path(args.domstolar_csv)
    whitelist_file = Path(args.whitelist_file)
    blacklist_file = Path(args.blacklist_file)

    directory = MunicipalityDirectory()
    directory.load(official_csv)
    whitelist_emails, whitelist_domains = load_manual_list(whitelist_file)
    blacklist_emails, blacklist_domains = load_manual_list(blacklist_file)

    manifest_rows = read_semicolon_dicts(manifest_csv)
    triage_rows = read_semicolon_dicts(triage_csv)

    manifest_names_by_email: Dict[str, Counter] = defaultdict(Counter)
    manifest_counts: Counter = Counter()
    triage_counts: Counter = Counter()

    for row in manifest_rows:
        email = normalize_email(row.get("sender", ""))
        if not looks_like_email(email):
            continue
        manifest_counts[email] += 1
        kommunnamn = (row.get("kommunnamn", "") or "").strip()
        if kommunnamn:
            manifest_names_by_email[email][pretty_municipality_name(kommunnamn)] += 1

    for row in triage_rows:
        email = normalize_email(row.get("SenderEmail", ""))
        if looks_like_email(email):
            triage_counts[email] += 1

    master: Dict[str, Dict[str, object]] = {}

    def ensure_row(email: str) -> Dict[str, object]:
        if email not in master:
            master[email] = {
                "Email": email,
                "EntityName": initial_entity_name(email),
                "EntityCode": "",
                "EntityType": "Okand",
                "ContactRole": "Svarsavsandare",
                "SourceTypes": set(),
                "ClassificationSource": "",
                "SeenInOfficialContactFile": False,
                "SeenInManifest": False,
                "SeenInTriage": False,
                "ManifestCount": 0,
                "TriageCount": 0,
            }
        return master[email]

    # Seed official municipality contacts first.
    official_rows = read_semicolon_rows(official_csv)
    for row in official_rows[1:]:
        if len(row) < 6:
            continue
        code = row[0].strip()
        name = row[3].strip()
        for email, source_type, role in (
            (normalize_email(row[4].strip() if len(row) > 4 else ""), "official_primary", "Miljo_eller_registrator"),
            (normalize_email(row[5].strip() if len(row) > 5 else ""), "official_secondary", "Central_e_post"),
        ):
            if not looks_like_email(email):
                continue
            entry = ensure_row(email)
            entry["EntityName"] = name
            entry["EntityCode"] = code
            entry["EntityType"] = "Kommun"
            entry["ContactRole"] = role
            entry["ClassificationSource"] = source_type
            entry["SeenInOfficialContactFile"] = True
            entry["SourceTypes"].add(source_type)

    for row in load_extra_official_contacts(lansstyrelser_csv, "official_lansstyrelse"):
        entry = ensure_row(row["Email"])
        entry["EntityName"] = row["EntityName"]
        entry["EntityCode"] = row["EntityCode"]
        entry["EntityType"] = row["EntityType"]
        entry["ContactRole"] = row["ContactRole"]
        entry["ClassificationSource"] = row["ClassificationSource"]
        entry["SeenInOfficialContactFile"] = True
        entry["SourceTypes"].add("official_primary")

    for row in load_extra_official_contacts(domstolar_csv, "official_domstol"):
        entry = ensure_row(row["Email"])
        entry["EntityName"] = row["EntityName"]
        entry["EntityCode"] = row["EntityCode"]
        entry["EntityType"] = row["EntityType"]
        entry["ContactRole"] = row["ContactRole"]
        entry["ClassificationSource"] = row["ClassificationSource"]
        entry["SeenInOfficialContactFile"] = True
        entry["SourceTypes"].add("official_primary")

    # Merge Outlook senders.
    for email in sorted(set(manifest_counts) | set(triage_counts)):
        entry = ensure_row(email)
        entry["SeenInManifest"] = manifest_counts[email] > 0
        entry["SeenInTriage"] = triage_counts[email] > 0
        entry["ManifestCount"] = manifest_counts[email]
        entry["TriageCount"] = triage_counts[email]
        if manifest_counts[email]:
            entry["SourceTypes"].add("manifest_sender")
        if triage_counts[email]:
            entry["SourceTypes"].add("triage_sender")

        if entry["EntityType"] == "Okand":
            entity_name, entity_code, entity_type, role = directory.classify_email(
                email,
                manifest_names_by_email[email].keys(),
            )
            if entity_type != "Okand" or entity_name:
                entry["EntityName"] = entity_name or entry["EntityName"]
                entry["EntityCode"] = entity_code
                entry["EntityType"] = entity_type
                entry["ContactRole"] = role
                if entity_type == "Kommun":
                    entry["ClassificationSource"] = "municipality_match"
                elif entity_type == "Lansstyrelse":
                    entry["ClassificationSource"] = "authority_domain_match"
                elif entity_type == "Domstol":
                    entry["ClassificationSource"] = "court_domain_match"

    fieldnames = [
        "Email",
        "EntityName",
        "EntityCode",
        "EntityType",
        "ContactRole",
        "SourceTypes",
        "ClassificationSource",
        "SeenInOfficialContactFile",
        "SeenInManifest",
        "SeenInTriage",
        "ManifestCount",
        "TriageCount",
        "RecommendedForFutureMailout",
        "MailoutTier",
        "ExcludeReason",
    ]

    sendable_entity_types = {"Kommun", "Lansstyrelse", "Domstol"}
    materialized: List[Dict[str, str]] = []
    for entry in master.values():
        row = {
            "Email": str(entry["Email"]),
            "EntityName": str(entry["EntityName"]),
            "EntityCode": str(entry["EntityCode"]),
            "EntityType": str(entry["EntityType"]),
            "ContactRole": str(entry["ContactRole"]),
            "SourceTypes": ";".join(sorted(entry["SourceTypes"])),
            "ClassificationSource": str(entry["ClassificationSource"]),
            "SeenInOfficialContactFile": "True" if entry["SeenInOfficialContactFile"] else "False",
            "SeenInManifest": "True" if entry["SeenInManifest"] else "False",
            "SeenInTriage": "True" if entry["SeenInTriage"] else "False",
            "ManifestCount": str(entry["ManifestCount"]),
            "TriageCount": str(entry["TriageCount"]),
            "RecommendedForFutureMailout": "True",
            "MailoutTier": mailout_tier(entry["SourceTypes"]),
            "ExcludeReason": "",
        }
        reason = exclusion_reason(
            row["Email"],
            row["EntityType"],
            whitelist_emails,
            whitelist_domains,
            blacklist_emails,
            blacklist_domains,
        )
        if reason:
            row["RecommendedForFutureMailout"] = "False"
            row["MailoutTier"] = "exclude"
            row["ExcludeReason"] = reason
        elif row["EntityType"] not in sendable_entity_types:
            row["RecommendedForFutureMailout"] = "False"
            row["MailoutTier"] = "review"
            row["ExcludeReason"] = "manual_review_unknown_entity"
        materialized.append(row)

    materialized = sort_rows(materialized)
    sendable = [row for row in materialized if row["RecommendedForFutureMailout"] == "True"]
    kommuner = [row for row in sendable if row["EntityType"] == "Kommun"]
    lansstyrelser = [row for row in sendable if row["EntityType"] == "Lansstyrelse"]
    domstolar = [row for row in sendable if row["EntityType"] == "Domstol"]
    ovriga = [row for row in materialized if row["ExcludeReason"] == "manual_review_unknown_entity"]
    preferred_kommuner = build_preferred_contact_rows(kommuner)
    avvikande = sorted(
        [row for row in materialized if row["ExcludeReason"] or row["MailoutTier"] == "review"],
        key=anomaly_sort_key,
    )

    write_csv(output_dir / "framtida_utskickslista_master.csv", materialized, fieldnames)
    write_csv(output_dir / "framtida_utskickslista_skickbar.csv", sendable, fieldnames)
    write_csv(output_dir / "framtida_utskickslista_kommuner.csv", kommuner, fieldnames)
    write_csv(output_dir / "framtida_utskickslista_lansstyrelser.csv", lansstyrelser, fieldnames)
    write_csv(output_dir / "framtida_utskickslista_domstolar.csv", domstolar, fieldnames)
    write_csv(output_dir / "framtida_utskickslista_ovriga_att_granska.csv", ovriga, fieldnames)
    write_csv(
        output_dir / "framtida_utskickslista_kommuner_en_per_kommun.csv",
        preferred_kommuner,
        [
            "EntityCode",
            "EntityName",
            "EntityType",
            "PreferredEmail",
            "PreferredContactRole",
            "PreferredSourceTypes",
            "PreferredClassificationSource",
            "ManifestCount",
            "TriageCount",
            "SelectionReason",
            "OfficialPrimaryEmail",
            "OfficialSecondaryEmail",
            "AllCandidateEmails",
            "CandidateCount",
        ],
    )
    write_csv(output_dir / "framtida_utskickslista_avvikande_sorterad.csv", avvikande, fieldnames)

    excluded = [row for row in materialized if row["RecommendedForFutureMailout"] == "False"]
    print(f"MASTER_COUNT={len(materialized)}")
    print(f"SENDABLE_COUNT={len(sendable)}")
    print(f"KOMMUNER_COUNT={len(kommuner)}")
    print(f"KOMMUNER_PRIMARY_COUNT={len(preferred_kommuner)}")
    print(f"LANSSTYRELSER_COUNT={len(lansstyrelser)}")
    print(f"DOMSTOLAR_COUNT={len(domstolar)}")
    print(f"OVRIGA_COUNT={len(ovriga)}")
    print(f"AVVIKANDE_COUNT={len(avvikande)}")
    print(f"EXCLUDED_COUNT={len(excluded)}")
    for reason, count in sorted(Counter(row["ExcludeReason"] for row in excluded).items()):
        print(f"EXCLUDED_{reason.upper()}={count}")


if __name__ == "__main__":
    main()
