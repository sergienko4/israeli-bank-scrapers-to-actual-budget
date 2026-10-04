/**
 * Builds small uncompressed ZIP archives in memory, so installer tests can
 * serve a real archive to the extractor without a zip tool or library.
 */

import { crc32 } from 'node:zlib';

/** One file to store in the archive. */
export interface IZipEntry {
  readonly name: string;
  readonly content: string;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION_2_0 = 20;
/** DOS date for 1980-01-01, the earliest a ZIP timestamp can express. */
const DOS_DATE_1980_01_01 = 0x21;

/** The two records of one stored entry, ready to concatenate. */
interface IStoredEntry {
  readonly local: Buffer;
  readonly central: Buffer;
}

/**
 * Encodes one entry as its local record and its central-directory record.
 * @param entry - File name and text content.
 * @param offset - Byte offset of the local record inside the archive.
 * @returns Both records for the entry.
 */
function storeEntry(entry: IZipEntry, offset: number): IStoredEntry {
  const name = Buffer.from(entry.name, 'utf8');
  const data = Buffer.from(entry.content, 'utf8');
  const checksum = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(ZIP_VERSION_2_0, 4);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  central.writeUInt16LE(ZIP_VERSION_2_0, 4);
  central.writeUInt16LE(ZIP_VERSION_2_0, 6);
  central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  return {
    local: Buffer.concat([header, name, data]),
    central: Buffer.concat([central, name]),
  };
}

/**
 * Builds a ZIP archive whose entries are stored without compression.
 * @param entries - Files to store, in archive order.
 * @returns The archive bytes.
 */
export function buildStoredZip(entries: readonly IZipEntry[]): Buffer {
  const stored: IStoredEntry[] = [];
  let offset = 0;
  for (const entry of entries) {
    const record = storeEntry(entry, offset);
    stored.push(record);
    offset += record.local.length;
  }
  const centralDirectory = Buffer.concat(stored.map((record) => record.central));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...stored.map((record) => record.local), centralDirectory, end]);
}
