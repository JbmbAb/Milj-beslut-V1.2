import path from 'path';

/**
 * Storage Abstraction för Geodata, Juridik och Mjukvaru-mallar.
 * Denna struktur skiljer huvudapplikationen från rådatadomänerna.
 */

const BASE_DESKTOP_PATH = path.resolve('C:/Users/jimmy/Desktop/MiljoBeslut_Produktdata');

export const DataStoragePaths = {
  GEODATA: path.join(BASE_DESKTOP_PATH, 'Geodata'),
  JURIDIK: path.join(BASE_DESKTOP_PATH, 'Juridik_Referens'),
  KARTOR: path.join(BASE_DESKTOP_PATH, 'Kartor'),
  MALLAR: path.join(BASE_DESKTOP_PATH, 'Mallar_Ingest'),
  API_METADATA: path.join(BASE_DESKTOP_PATH, 'API_Metadata'),
};

export const getGeodataFile = (filename: string) => path.join(DataStoragePaths.GEODATA, filename);
export const getJuridikFile = (filename: string) => path.join(DataStoragePaths.JURIDIK, filename);
export const getKartaPath = (uuid: string) => path.join(DataStoragePaths.KARTOR, uuid);
