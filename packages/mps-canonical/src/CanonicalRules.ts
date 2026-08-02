export const CANONICAL_RULES_VERSION = "1.0.0";

export const CANONICAL_RULES = {
    object_key_order: "LEXICOGRAPHIC_UTF8",
    string_normalization: "UNICODE_NFC",
    timestamp_format: "RFC3339_UTC_NO_MILLISECONDS",
    floating_point: "IEEE754_CANONICAL",
    binary_encoding: "BIG_ENDIAN",
    map_order: "SORTED",
    array_policy: "ORDER_PRESERVED",
    null_policy: "JSON_NULL",
    unicode_escape_policy: "MINIMAL",
    whitespace_policy: "NONE"
} as const;

export type CanonicalRules = typeof CANONICAL_RULES;
