/**
 * Runs one inspection against an open descriptor, then always releases it.
 *
 * <p>The port reports whether a descriptor actually closed, and every place
 * the store opened one used to discard that answer, reporting a clean
 * success after the platform had said otherwise. Three sites, one rule, so
 * the rule lives here once: a descriptor that would not close fails the
 * inspection it belonged to.
 *
 * <p>Failing is all a caller can usefully do. Linux frees the descriptor
 * before reporting the error, so a retry would at best do nothing and at
 * worst close a descriptor some other code has since been given. What is
 * left is not to pretend the operation finished cleanly.
 * @module
 */

import type { Procedure } from '../Types/Procedure.js';
import { fail } from '../Types/ProcedureHelpers.js';
import type { IFileSystem, IOpenFile } from './FileSystemPort.js';

/**
 * Folds a refused close into the outcome of the work done before it.
 *
 * <p>An earlier failure is still the one reported and the close is noted
 * beside it, because why the work failed matters more than the tidy-up.
 * @param outcome - What the inspection returned.
 * @param file - Descriptor that would not close.
 * @returns A failure: the original one with a note, or a new one.
 */
function noteUnreleased<T>(outcome: Procedure<T>, file: IOpenFile): Procedure<T> {
  const note = `Descriptor ${String(file.descriptor)} could not be released`;
  if (outcome.success) return fail(note, { status: 'EIO' });
  const details = [...(outcome.details ?? []), note];
  return { ...outcome, details };
}

/**
 * Inspects an open descriptor and releases it, even if inspection throws.
 * @param fileSystem - Port the descriptor came from.
 * @param file - Descriptor to inspect and then release.
 * @param inspect - Work to do while the descriptor is open.
 * @returns The inspection's outcome, or a failure if the close was refused.
 */
export default function closeAfter<T>(
  fileSystem: IFileSystem,
  file: IOpenFile,
  inspect: (opened: IOpenFile) => Procedure<T>,
): Procedure<T> {
  let outcome: Procedure<T>;
  let wasClosed: boolean;
  try {
    outcome = inspect(file);
  } finally {
    wasClosed = fileSystem.close(file).wasClosed;
  }
  return wasClosed ? outcome : noteUnreleased(outcome, file);
}
