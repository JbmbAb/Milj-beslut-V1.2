import React from 'react';

type LegalBlock = {
  id: string;
  title: string;
  items: string[];
};

const env = import.meta.env as Record<string, string | undefined>;

const CONTACT = {
  companyName: env.VITE_COMPANY_NAME || 'Miljöbeslut.se 2.0',
  supportEmail: env.VITE_SUPPORT_EMAIL || 'support@miljobeslut.se',
  legalEmail: env.VITE_LEGAL_EMAIL || 'legal@miljobeslut.se',
  phone: env.VITE_SUPPORT_PHONE || '+46 8 00 00 00',
  supportHours: env.VITE_SUPPORT_HOURS || 'Vardagar 08:00-17:00',
  postalAddress: env.VITE_COMPANY_ADDRESS || 'Ange företagsadress i miljö-konfiguration',
};

const LEGAL_BLOCKS: LegalBlock[] = [
  {
    id: 'gdpr-basis',
    title: 'GDPR och rättslig grund',
    items: [
      'Personuppgifter behandlas för avtal, rättslig förpliktelse och berättigat intresse beroende på funktion.',
      'Dataminimering gäller: endast uppgifter nödvändiga för ärende, tillsyn, rapportering och support sparas.',
      'Syfte, lagringstid och ansvarig enhet ska vara dokumenterad per datakategori.',
    ],
  },
  {
    id: 'rights',
    title: 'Registrerades rättigheter',
    items: [
      'Rätt till registerutdrag, rättelse, radering och begränsning av behandling hanteras via legal kontakt.',
      'Begäran om dataportabilitet och invändning loggas i audit trail med handläggningsdatum.',
      'Vid tvist informeras registrerad om klagomål till Integritetsskyddsmyndigheten (IMY).',
    ],
  },
  {
    id: 'security',
    title: 'Säkerhet och incidenthantering',
    items: [
      'Åtkomst styrs via token/session och rollbaserad behörighet i adminfloden.',
      'Audit trail ska vara sparbar och visa vem som ändrat vad och när.',
      'Personuppgiftsincidenter eskaleras utan dröjsmål enligt intern incidentrutin.',
    ],
  },
  {
    id: 'cookies',
    title: 'Cookies och spårning',
    items: [
      'Nödvändiga cookies får användas för inloggning och säker drift.',
      'Icke nödvändiga cookies aktiveras först efter samtycke via cookie-banner.',
      'Användare ska kunna ändra cookieval och se uppdaterad cookieinformation.',
    ],
  },
];

const HELP_TOPICS = [
  'Inloggning och behörighet',
  'Projektplan och stage-gates',
  'Sökning, indexstatus och datakällor',
  'Export, rapportering och audit',
  'Juridik, GDPR och personuppgifter',
];

const LegalSupportCenter: React.FC = () => {
  return (
    <div className="mx-auto max-w-6xl space-y-8 animate-in fade-in duration-500">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Juridik och support</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">GDPR, kontakt och integrerad hjälp</h2>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Denna vy samlar juridisk minimikravsnivå for webbtjänsten samt hur anvandare far hjälp och kontaktar ansvarig funktion.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {LEGAL_BLOCKS.map((block) => (
          <article key={block.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">{block.title}</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              {block.items.map((item) => (
                <li key={item} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Integrerad hjälp</p>
          <h3 className="mt-2 text-xl font-black text-slate-900">Supportflöde i tjänsten</h3>
          <p className="mt-2 text-sm text-slate-600">
            Chatbot och guide kompletteras med manuell support for incidenter, juridiska frågor och dataskyddsfrågor.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {HELP_TOPICS.map((topic) => (
              <div key={topic} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
                {topic}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-white shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Kontaktinformation</p>
          <div className="mt-4 space-y-3 text-sm">
            <p>
              Bolag: <span className="font-black">{CONTACT.companyName}</span>
            </p>
            <p>
              Support: <a href={`mailto:${CONTACT.supportEmail}`} className="font-black text-blue-300">{CONTACT.supportEmail}</a>
            </p>
            <p>
              Legal/DPO: <a href={`mailto:${CONTACT.legalEmail}`} className="font-black text-blue-300">{CONTACT.legalEmail}</a>
            </p>
            <p>
              Telefon: <span className="font-black">{CONTACT.phone}</span>
            </p>
            <p>
              Tillgänglighet: <span className="font-black">{CONTACT.supportHours}</span>
            </p>
            <p>
              Adress: <span className="font-black">{CONTACT.postalAddress}</span>
            </p>
          </div>
          <p className="mt-4 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs text-slate-200">
            Uppdatera kontaktfälten via `VITE_SUPPORT_EMAIL`, `VITE_LEGAL_EMAIL`, `VITE_SUPPORT_PHONE` och `VITE_COMPANY_ADDRESS`.
          </p>
        </div>
      </section>
    </div>
  );
};

export default LegalSupportCenter;
