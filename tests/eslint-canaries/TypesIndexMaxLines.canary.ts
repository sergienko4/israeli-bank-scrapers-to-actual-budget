// Canary: should trigger `max-lines: 80` cap on src/Types/**.
//
// PR 25 (Section 7t of eslint.config.mjs) tightens `max-lines` from the
// default 300 down to 80 for:
//   - src/Types/**/*.ts
//   - tests/eslint-canaries/TypesIndexMaxLines.canary.ts  ← this file
//
// After the Types barrel split, src/Types/Index.ts is a pure re-export
// facade and each domain concern (Actual, Bank, Notifications, Logging,
// Categorization, Telegram, Importer, Import) lives in its own file. The
// largest file is the Index.ts barrel at ~59 effective LoC; the cap of 80
// gives ~35% headroom per eslint-rules-guidlines.md §1 PRECEDENT. Any new
// type group MUST land in a new `src/Types/<Domain>.ts` file rather than
// growing an existing one back toward a god-file.
//
// This canary exceeds 80 effective LoC (skipBlankLines + skipComments
// configured) so the canary harness can prove the rule is alive on every
// commit.
//
// The fixture is intentionally a flat list of trivial constant
// declarations to keep other ESLint rules quiet (no nested calls, no
// nullable returns, no missing JSDoc). It is NOT exercised at runtime.
export const fakeConst001 = 1;
export const fakeConst002 = 2;
export const fakeConst003 = 3;
export const fakeConst004 = 4;
export const fakeConst005 = 5;
export const fakeConst006 = 6;
export const fakeConst007 = 7;
export const fakeConst008 = 8;
export const fakeConst009 = 9;
export const fakeConst010 = 10;
export const fakeConst011 = 11;
export const fakeConst012 = 12;
export const fakeConst013 = 13;
export const fakeConst014 = 14;
export const fakeConst015 = 15;
export const fakeConst016 = 16;
export const fakeConst017 = 17;
export const fakeConst018 = 18;
export const fakeConst019 = 19;
export const fakeConst020 = 20;
export const fakeConst021 = 21;
export const fakeConst022 = 22;
export const fakeConst023 = 23;
export const fakeConst024 = 24;
export const fakeConst025 = 25;
export const fakeConst026 = 26;
export const fakeConst027 = 27;
export const fakeConst028 = 28;
export const fakeConst029 = 29;
export const fakeConst030 = 30;
export const fakeConst031 = 31;
export const fakeConst032 = 32;
export const fakeConst033 = 33;
export const fakeConst034 = 34;
export const fakeConst035 = 35;
export const fakeConst036 = 36;
export const fakeConst037 = 37;
export const fakeConst038 = 38;
export const fakeConst039 = 39;
export const fakeConst040 = 40;
export const fakeConst041 = 41;
export const fakeConst042 = 42;
export const fakeConst043 = 43;
export const fakeConst044 = 44;
export const fakeConst045 = 45;
export const fakeConst046 = 46;
export const fakeConst047 = 47;
export const fakeConst048 = 48;
export const fakeConst049 = 49;
export const fakeConst050 = 50;
export const fakeConst051 = 51;
export const fakeConst052 = 52;
export const fakeConst053 = 53;
export const fakeConst054 = 54;
export const fakeConst055 = 55;
export const fakeConst056 = 56;
export const fakeConst057 = 57;
export const fakeConst058 = 58;
export const fakeConst059 = 59;
export const fakeConst060 = 60;
export const fakeConst061 = 61;
export const fakeConst062 = 62;
export const fakeConst063 = 63;
export const fakeConst064 = 64;
export const fakeConst065 = 65;
export const fakeConst066 = 66;
export const fakeConst067 = 67;
export const fakeConst068 = 68;
export const fakeConst069 = 69;
export const fakeConst070 = 70;
export const fakeConst071 = 71;
export const fakeConst072 = 72;
export const fakeConst073 = 73;
export const fakeConst074 = 74;
export const fakeConst075 = 75;
export const fakeConst076 = 76;
export const fakeConst077 = 77;
export const fakeConst078 = 78;
export const fakeConst079 = 79;
export const fakeConst080 = 80;
export const fakeConst081 = 81;
export const fakeConst082 = 82;
export const fakeConst083 = 83;
export const fakeConst084 = 84;
export const fakeConst085 = 85;
export const fakeConst086 = 86;
export const fakeConst087 = 87;
export const fakeConst088 = 88;
export const fakeConst089 = 89;
export const fakeConst090 = 90;
export const fakeConst091 = 91;
export const fakeConst092 = 92;
