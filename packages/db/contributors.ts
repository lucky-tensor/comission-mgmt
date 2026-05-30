/**
 * Re-export shim for the contributors DB module.
 * Allows imports via 'db/contributors' consistent with tsconfig path mapping.
 */
export {
  createContributor,
  listContributors,
  deleteContributor,
  getSplitTotal,
} from './src/contributors.js';
export type { Contributor, CreateContributorInput } from './src/contributors.js';
