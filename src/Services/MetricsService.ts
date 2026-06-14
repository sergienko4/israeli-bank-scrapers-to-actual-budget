/** Provides the compatibility facade for legacy MetricsService imports. @public */
/*
export type { ITransactionRecord } from '../Types/Index.js';
export interface IAccountMetrics {
export interface IAccountTransactionsRecord {
export interface IBankMetrics {
export interface IImportSummary {
export class MetricsService {
*/
 export type {
   IAccountMetrics,
   IAccountTransactionsRecord,
   IBankMetrics,
   IImportSummary,
   ITransactionRecord,
 } from './Metrics/Index.js';
 export { MetricsService } from './Metrics/Index.js';
