/**
 * Repository layer.
 *
 * The UI talks to these; it never writes SQL. Grouping them behind one object
 * keeps wiring simple and makes the whole data layer swappable for tests.
 */
import type { SqlDriver } from "../driver";
import { WorkspaceRepository } from "./workspace-repository";
import { AccountRepository } from "./account-repository";
import { LedgerEntryRepository } from "./ledger-entry-repository";
import { ContactRepository } from "./contact-repository";
import { CategoryRepository } from "./category-repository";
import { AnnotationRepository } from "./annotation-repository";
import { RuleRepository } from "./rule-repository";
import { PendingAnnotationRepository } from "./pending-annotation-repository";
import { PriceRepository } from "./price-repository";
import {
  SettingsRepository,
  StellarTransactionRepository,
  SyncIssueRepository,
} from "./support-repositories";

export interface Repositories {
  driver: SqlDriver;
  workspaces: WorkspaceRepository;
  accounts: AccountRepository;
  entries: LedgerEntryRepository;
  contacts: ContactRepository;
  categories: CategoryRepository;
  annotations: AnnotationRepository;
  rules: RuleRepository;
  pendingAnnotations: PendingAnnotationRepository;
  prices: PriceRepository;
  syncIssues: SyncIssueRepository;
  transactions: StellarTransactionRepository;
  settings: SettingsRepository;
}

export function createRepositories(driver: SqlDriver): Repositories {
  return {
    driver,
    workspaces: new WorkspaceRepository(driver),
    accounts: new AccountRepository(driver),
    entries: new LedgerEntryRepository(driver),
    contacts: new ContactRepository(driver),
    categories: new CategoryRepository(driver),
    annotations: new AnnotationRepository(driver),
    rules: new RuleRepository(driver),
    pendingAnnotations: new PendingAnnotationRepository(driver),
    prices: new PriceRepository(driver),
    syncIssues: new SyncIssueRepository(driver),
    transactions: new StellarTransactionRepository(driver),
    settings: new SettingsRepository(driver),
  };
}

export {
  WorkspaceRepository,
  AccountRepository,
  LedgerEntryRepository,
  ContactRepository,
  CategoryRepository,
  AnnotationRepository,
  RuleRepository,
  PendingAnnotationRepository,
  PriceRepository,
  SyncIssueRepository,
  StellarTransactionRepository,
  SettingsRepository,
};
export { DuplicateAccountError } from "./account-repository";
export { AddressAlreadyAssignedError } from "./contact-repository";
export type { ContactSummary, UnnamedCounterparty } from "./contact-repository";
export type { CategoryNode } from "./category-repository";
export type { AnnotationChanges } from "./annotation-repository";
export type { ResolvedMovement } from "./ledger-entry-repository";
export type { PendingAnnotation } from "./pending-annotation-repository";
