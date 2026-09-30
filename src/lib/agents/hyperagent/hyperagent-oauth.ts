import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export const HYPERAGENT_OAUTH_CLIENT_NAME = "QOS Platform";

/** The whole OAuth session, stored only inside the encrypted credential blob. */
export type HyperagentOAuthState = {
  /** Loopback redirect registered by the operator CLI; reused so the client stays valid. */
  redirectUrl?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  discoveryState?: OAuthDiscoveryState;
};

export function readHyperagentOAuthState(value: Record<string, unknown>): HyperagentOAuthState {
  const state: HyperagentOAuthState = {};
  if (typeof value.redirectUrl === "string") {
    state.redirectUrl = value.redirectUrl;
  }
  if (value.clientInformation && typeof value.clientInformation === "object") {
    state.clientInformation = value.clientInformation as OAuthClientInformationMixed;
  }
  if (value.tokens && typeof value.tokens === "object") {
    state.tokens = value.tokens as OAuthTokens;
  }
  if (value.discoveryState && typeof value.discoveryState === "object") {
    state.discoveryState = value.discoveryState as OAuthDiscoveryState;
  }
  return state;
}

type QosOAuthClientProviderOptions = {
  redirectUrl: string;
  /** OAuth `state` for interactive sessions; the callback must echo it back. */
  oauthState?: string;
  initialState?: HyperagentOAuthState;
  /** Persists the new state; called whenever the SDK registers or refreshes. */
  onStateChanged?: (state: HyperagentOAuthState) => Promise<void>;
  /**
   * Interactive (operator CLI) sessions open the authorization URL. Runtime
   * sessions pass nothing: a required redirect only records `reauthRequired`.
   */
  onAuthorizationUrl?: (url: URL) => void | Promise<void>;
};

/**
 * SDK `OAuthClientProvider` backed by a QOS-held state object. The SDK owns
 * discovery, registration, PKCE, token exchange and refresh; this only stores.
 */
export class QosOAuthClientProvider implements OAuthClientProvider {
  private session: HyperagentOAuthState;
  private verifier: string | null = null;
  private readonly options: QosOAuthClientProviderOptions;
  reauthRequired = false;

  constructor(options: QosOAuthClientProviderOptions) {
    this.options = options;
    this.session = { ...options.initialState, redirectUrl: options.redirectUrl };
  }

  get redirectUrl() {
    return this.options.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: HYPERAGENT_OAUTH_CLIENT_NAME,
      redirect_uris: [this.options.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state() {
    return this.options.oauthState ?? "";
  }

  snapshot(): HyperagentOAuthState {
    return structuredClone(this.session);
  }

  clientInformation() {
    return this.session.clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    this.session.clientInformation = clientInformation;
    await this.options.onStateChanged?.(this.snapshot());
  }

  tokens() {
    return this.session.tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    this.session.tokens = tokens;
    this.reauthRequired = false;
    await this.options.onStateChanged?.(this.snapshot());
  }

  discoveryState() {
    return this.session.discoveryState;
  }

  saveDiscoveryState(discoveryState: OAuthDiscoveryState) {
    this.session.discoveryState = discoveryState;
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    if (!this.options.onAuthorizationUrl) {
      this.reauthRequired = true;
      return;
    }
    await this.options.onAuthorizationUrl(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string) {
    this.verifier = codeVerifier;
  }

  codeVerifier() {
    if (!this.verifier) {
      throw new Error("No PKCE code verifier is pending for this OAuth session.");
    }
    return this.verifier;
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    if (scope === "all" || scope === "tokens") {
      this.session.tokens = undefined;
    }
    if (scope === "all" || scope === "client") {
      this.session.clientInformation = undefined;
    }
    if (scope === "all" || scope === "discovery") {
      this.session.discoveryState = undefined;
    }
    if (scope === "all" || scope === "verifier") {
      this.verifier = null;
    }
  }
}
