export interface CanonicalizationProfile {
  id: string;
  version: string;
  algorithm: "RFC8785";
  normalization: {
    unicode: "NFC";
    numbers: "RFC8785";
  };
}
