import { requestJson, type FabricRequestOptions } from './http.js';
import type {
  CreateOfferRequest,
  CreateOfferResponse,
  MeResponse,
  RecoveryCompleteRequest,
  RecoveryCompleteResponse,
  RecoveryStartRequest,
  RecoveryStartResponse,
  SearchListingsResponse,
  SearchRequestBody,
} from './types.js';

export type FabricClientOptions = {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
};

export class FabricClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: FabricClientOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl;
  }

  me(options?: FabricRequestOptions) {
    return requestJson<MeResponse>({
      ...options,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      fetchImpl: this.fetchImpl,
      method: 'GET',
      path: '/v1/me',
    });
  }

  searchListings(body: SearchRequestBody, options?: FabricRequestOptions) {
    return requestJson<SearchListingsResponse, SearchRequestBody>({
      ...options,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      fetchImpl: this.fetchImpl,
      method: 'POST',
      path: '/v1/search/listings',
      body,
    });
  }

  createOffer(body: CreateOfferRequest, options?: FabricRequestOptions) {
    return requestJson<CreateOfferResponse, CreateOfferRequest>({
      ...options,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      fetchImpl: this.fetchImpl,
      method: 'POST',
      path: '/v1/offers',
      body,
    });
  }

  recoveryStart(body: RecoveryStartRequest, options?: FabricRequestOptions) {
    return requestJson<RecoveryStartResponse, RecoveryStartRequest>({
      ...options,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      fetchImpl: this.fetchImpl,
      method: 'POST',
      path: '/v1/recovery/start',
      body,
    });
  }

  recoveryComplete(body: RecoveryCompleteRequest, options?: FabricRequestOptions) {
    return requestJson<RecoveryCompleteResponse, RecoveryCompleteRequest>({
      ...options,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      fetchImpl: this.fetchImpl,
      method: 'POST',
      path: '/v1/recovery/complete',
      body,
    });
  }
}
