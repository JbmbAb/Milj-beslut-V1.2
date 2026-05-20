import { useEffect } from 'react';
import type { AdminModuleId } from '../AdminShell';

interface PageMeta {
  title: string;
  description: string;
  keywords: string[];
}

const MODULE_META: Record<AdminModuleId, PageMeta> = {
  'permit-portal': {
    title: 'Core Tillståndsportal | Miljöbeslut Admin',
    description:
      'Hantera miljötillståndsansökningar från initiering till beslut. Spårning, dokumentation och statusöversikt.',
    keywords: ['tillståndsportal', 'miljötillstånd', 'ansökningar', 'handläggning'],
  },
  logistics: {
    title: 'Logistik & Massa | Miljöbeslut Admin',
    description:
      'Övervaka transporter, lagring och miljöpåverkan. GPS-spårning, CO₂-rapportering och lagerstatus.',
    keywords: ['logistik', 'transporter', 'CO₂-rapportering', 'lagerförteckning'],
  },
  'project-plan': {
    title: 'Projektplan | Miljöbeslut Admin',
    description: 'Tidsplanering, fashantering och resurser. Gantt-schema, milstolpar och stakeholder-lista.',
    keywords: ['projektplan', 'tidsplanering', 'gantt-schema', 'milstolpar'],
  },
  'green-check': {
    title: 'Grönkoll för Banker | Miljöbeslut Admin',
    description:
      'Risk-bedömning, miljörapportering och finansiering. ESG-rating, kreditvärdighet och compliance.',
    keywords: ['grönkoll', 'risk-bedömning', 'ESG-rating', 'miljörapportering'],
  },
  'sewage-portal': {
    title: 'Enskilt Avlopp | Miljöbeslut Admin',
    description: 'Ansökan och övervakning av privata VA-anläggningar. Inspektionsscheman och kartöversikt.',
    keywords: ['enskilt avlopp', 'VA-anläggning', 'ansökan', 'inspekton'],
  },
};

/**
 * useAdminPageMeta – Hook för att sätta SEO-metadata för admin-sidor
 * Uppdaterar document.title och meta-tags dynamiskt
 * WCAG 2.1 AA kompatibel
 */
export const useAdminPageMeta = (moduleId: AdminModuleId) => {
  useEffect(() => {
    const meta = MODULE_META[moduleId];

    // Set title
    document.title = meta.title;

    // Update or create meta tags
    const updateOrCreateMetaTag = (name: string, content: string) => {
      let tag = document.querySelector(`meta[name="${name}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('name', name);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };

    updateOrCreateMetaTag('description', meta.description);
    updateOrCreateMetaTag('keywords', meta.keywords.join(', '));

    // Add robots meta (noindex för admin-sidor)
    updateOrCreateMetaTag('robots', 'noindex, nofollow');

    // Add og: tags for social sharing (optional)
    const updateOrCreateOGTag = (property: string, content: string) => {
      let tag = document.querySelector(`meta[property="${property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute('property', property);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };

    updateOrCreateOGTag('og:title', meta.title);
    updateOrCreateOGTag('og:description', meta.description);
    updateOrCreateOGTag('og:type', 'website');

    // Cleanup: reset on unmount
    return () => {
      document.title = 'Miljöbeslut | Admin';
    };
  }, [moduleId]);
};
