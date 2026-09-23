/*
 * Copyright 2026 Jeffrey Guntly (JX Holdings, LLC)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * CardSpoke Core Type Definitions
 * @version 0.21.0
 * @module @cardspoke/core
 */

export interface Card {
  id: string;
  title: string;
  body: string;
  tags: string[];
  parentId: string | null;
  children: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
}

export interface Store {
  cards: Record<string, Card>;
  rootOrder: string[];
  bookmarks: string[];
  recentCards: string[];
  /** Persisted installed plugins, keyed by id. See PersistedPlugin. */
  plugins: Record<string, PersistedPlugin>;
  schemaVersion: number;
  metadata?: Record<string, any>;
}

/**
 * A plugin as stored in the dataset payload. Pure JSON — the js/teardownJs
 * source strings are the canonical executable form, reconstructed by
 * Plugin.syncFromStore() on load. Entries without `definition` are legacy
 * (pre-v2) plugins the current runtime does not execute.
 */
export interface PersistedPlugin {
  definition?: {
    manifest: ModManifest;
    css?: string;
    js?: string;
    teardownJs?: string;
  };
  enabled: boolean;
}

export type ModLayer = 'theme' | 'feature' | 'app';
export type PermissionType = 'ui-override' | 'storage' | 'network' | 'filesystem' | 'core-override' | 'data-modify';

export interface ModManifest {
  id?: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  layer: ModLayer;
  compatibility?: string;
  permissions?: PermissionType[];
  /** User-configurable settings; surfaced as ctx.config and a settings panel. */
  config?: Record<string, any>;
  /** App-layer host overrides (currently implemented: appName). */
  overrides?: ModOverrides;
  /** Plugin ids that must already be installed. */
  dependencies?: string[];
}

export interface ModPackage {
  id?: string;
  manifest: ModManifest;
  config?: Record<string, any>;
  css?: string;
  /** Setup-function BODY (receives `ctx`); the persisted, canonical form. */
  js?: string;
  /** Teardown-function body (extra cleanup). */
  teardownJs?: string;
  overrides?: ModOverrides;
  /** Persisted enabled/suspended state (set by the runtime). */
  enabled?: boolean;
}

export interface ModOverrides {
  appName?: string;
  hideMenuItems?: string[];
  customMenuItems?: Array<{
    id: string;
    label: string;
    section?: string;
  }>;
  customPages?: Array<{
    id: string;
    title: string;
    render: string;
  }>;
  disableFeatures?: string[];
}

export interface PluginContext {
  modId: string;
  appVersion: string;
  schemaVersion: number;
  /** Present when the manifest declares `config`; the settings panel writes here. */
  config?: Record<string, any>;
  /** Build a vnode — see Vnode. Not available on the legacy (function-form) host-code ctx. */
  h?(tag: string, props?: VnodeProps, children?: VnodeChild | VnodeChild[]): Vnode;
  api: PluginAPI;
  utils: PluginUtils;
  logger: Logger;
}

/**
 * A plain, serializable UI description built by `ctx.h(...)` inside a
 * sandboxed plugin's worker (no DOM exists there — see plugin-vnode.js).
 * The host converts this to a real HTMLElement.
 */
export interface Vnode {
  __vnode: true;
  tag: string;
  props: VnodeProps;
  children: VnodeChild[];
}

export type VnodeChild = Vnode | string | number;

export interface VnodeProps {
  className?: string;
  style?: string | Record<string, string>;
  dataset?: Record<string, string>;
  [attr: string]: any;
  onclick?: (event: VnodeEventDescriptor) => void | VnodeEventResult | Promise<void | VnodeEventResult>;
  oninput?: (event: VnodeEventDescriptor) => void | VnodeEventResult | Promise<void | VnodeEventResult>;
  onchange?: (event: VnodeEventDescriptor) => void | VnodeEventResult | Promise<void | VnodeEventResult>;
  onkeydown?: (event: VnodeEventDescriptor) => void | VnodeEventResult | Promise<void | VnodeEventResult>;
}

/**
 * A safe, serializable summary of a DOM event — never the real Event object
 * (Events aren't structured-clonable, and shouldn't be exposed raw anyway).
 */
export interface VnodeEventDescriptor {
  type: string;
  key?: string;
  code?: string;
  clientX?: number;
  clientY?: number;
  target?: {
    value?: any;
    checked?: boolean;
    dataset?: Record<string, string>;
  };
}

export interface VnodeEventResult {
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

/** Returned by ui.inject/ui.replace — there is no live node reference to hold onto. */
export interface UIHandle {
  remove(): Promise<void>;
  update(vnode: Vnode): Promise<void>;
}

export interface Logger {
  log(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

export interface PluginAPI {
  ui: UIApi;
  data: DataApi;
  storage: StorageApi;
  events: EventApi;
  middleware: MiddlewareApi;
  network: NetworkApi;
  filesystem: FilesystemApi;
}

export interface MiddlewareApi {
  /**
   * Register a tracked, per-plugin-namespaced middleware. Returns an
   * unregister function. `operations: ['card.render']` routes to the
   * decorator contract (CardRenderDecorator), not MiddlewareFunction — see
   * docs/architecture/PLUGIN_SYSTEM.md "The card.render decorator contract".
   */
  register(middleware: Middleware | CardRenderMiddleware): () => void;
  unregister(name: string): void;
}

export interface NetworkApi {
  /** Always proxied through the main thread — the worker never performs a real request itself, even once granted. */
  fetch(url: string, options?: any): Promise<SandboxedResponse>;
  /** Not available in the sandboxed runtime — XMLHttpRequest's stateful/event-driven shape does not cross a Worker boundary safely. Use fetch(). */
  xhr(): never;
}

/** A serializable stand-in for the Fetch Response object (a real Response can't cross the Worker boundary). */
export interface SandboxedResponse {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: { get(name: string): string | null; entries(): IterableIterator<[string, string]> };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<any>;
}

export interface FilesystemApi {
  readFile(path: string, options?: any): Promise<any>;
  writeFile(path: string, data: any, options?: any): Promise<any>;
}

export interface UIApi {
  inject(selector: string, vnode: Vnode, position?: 'before' | 'after' | 'append' | 'prepend'): Promise<UIHandle>;
  replace(selector: string, vnode: Vnode): Promise<UIHandle>;
  registerComponent(name: string, component: Component): Promise<void>;
  unregisterComponent(name: string): Promise<void>;
  showToast(message: string, type?: 'success' | 'error' | 'info' | 'warning', duration?: number): Promise<void>;
}

export interface DataApi {
  onUpdate(callback: (event: DataUpdateEvent) => void): () => void;
  getCard(id: string): Promise<Card | undefined>;
  listCards(): Promise<Card[]>;
  createCard(data: Partial<Card>): Promise<string>;
  updateCard(id: string, updates: Partial<Card>): Promise<Card>;
  deleteCard(id: string): Promise<boolean>;
  getTags(cardId: string): Promise<string[]>;
  addTag(cardId: string, tag: string): Promise<boolean>;
  removeTag(cardId: string, tag: string): Promise<boolean>;
  setTags(cardId: string, tags: string[]): Promise<boolean>;
  getAllTags(): Promise<string[]>;
}

export interface StorageApi {
  getNamespace(): string;
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface EventApi {
  on(event: string, callback: (...args: any[]) => void): () => void;
  emit(event: string, ...args: any[]): void;
  once(event: string, callback: (...args: any[]) => void): () => void;
  off(event: string, callback: (...args: any[]) => void): void;
}

export interface DataUpdateEvent {
  type: 'card.create' | 'card.update' | 'card.delete';
  cardId: string;
  card?: Card;
}

export interface Component {
  /** Returns a vnode (ctx.h(...)), not an HTMLElement — see Vnode. May be async. */
  render(props: any): Vnode | Promise<Vnode>;
  priority?: number;
  onMount?(): void;
  onUnmount?(): void;
  onPropsChange?(oldProps: any, newProps: any): void;
  metadata?: ComponentMetadata;
}

export interface ComponentMetadata {
  name?: string;
  version?: string;
  description?: string;
  canReplace?: string[];
}

/**
 * Props passed to a registered Card component, once per render batch (see
 * docs/architecture/PLUGIN_SYSTEM.md "The card.render decorator contract").
 * Unlike the pre-sandbox API, there is no `onSelect` callback — a function
 * reference could technically cross the RPC boundary as a handle, but no
 * navigation-triggering `ctx.api` method exists yet for a custom Card
 * component to call back into. Build tiles as non-interactive presentation
 * for now, or use ctx.h's onclick with your own ctx.api.data reads.
 */
export interface CardComponentProps {
  card: Card;
  isSelected: boolean;
  opts: Record<string, any>;
}

/** Props passed to a registered Header component: the default header node (host-side only; not serializable to a plugin worker directly — passed through the componentRender RPC call as an opaque props bag) */
export interface HeaderComponentProps {
  header: HTMLElement;
}

/** Props passed to a registered Sidebar component: the default menu panel node */
export interface SidebarComponentProps {
  panel: HTMLElement;
}

/** Props passed to a registered SearchBar component: the default wrapper node */
export interface SearchBarComponentProps {
  wrapper: HTMLElement;
}

export interface MiddlewareContext {
  operation: string;
  args: any[];
  result?: any;
  error?: Error;
  /** Read-only flag indicating whether stopPropagation() was called */
  stopped: boolean;
  /** Read-only flag indicating whether preventDefault() was called */
  prevented: boolean;
  stopPropagation(): void;
  preventDefault(): void;
}

/** Used for card.create / card.update / card.delete / card.save — full onion-model semantics. */
export type MiddlewareFunction = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;

export interface Middleware {
  name: string;
  priority: number;
  operations: string[];
  handler: MiddlewareFunction;
}

/**
 * A serializable summary of an already-built default card tile — never a
 * live DOM node (see docs/architecture/PLUGIN_SYSTEM.md "The card.render
 * decorator contract" / PLUGIN_INVARIANTS.md §7).
 */
export interface CardTileSnapshot {
  classList: string[];
  hasBody: boolean;
  hasTags: boolean;
  tagTexts: string[];
  isCompact: boolean;
}

/** A patch the host applies to the real tile after a card.render decorator resolves. */
export interface CardRenderPatch {
  addClass?: string[];
  removeClass?: string[];
  /** '' selector addresses the tile root itself. */
  setStyle?: Record<string, Record<string, string>>;
  /** Per-matched-element (by DOM order) style, keyed by selector. */
  setStyleByIndex?: Record<string, Array<Record<string, string>>>;
  appendChildren?: Record<string, Vnode[]>;
  prependChildren?: Record<string, Vnode[]>;
}

/**
 * `ctx.api.middleware.register({ operations: ['card.render'], handler })`
 * uses THIS handler shape, not MiddlewareFunction — no live DOM node, no
 * next()/stopPropagation()/preventDefault(). Every registered decorator is
 * independent and additive (PLUGIN_INVARIANTS.md §7).
 */
export interface CardRenderMiddleware {
  name: string;
  priority?: number;
  operations: ['card.render'];
  handler: (card: Card, tileSnapshot: CardTileSnapshot) => CardRenderPatch | null | Promise<CardRenderPatch | null>;
}

/**
 * Async host helpers exposed as `ctx.utils` / `window.CardSpoke.utils`.
 * Populated in www/src/storage.js — keep this in step with that block.
 */
export interface PluginUtils {
  createCard(data: Partial<Card>): Promise<{ id: string; card: Card }>;
  updateCard(cardId: string, changes: Partial<Card>): Promise<boolean>;
  getCard(cardId: string): Promise<Card | null>;
  searchCards(query: string): Promise<Card[]>;
  getTags(cardId: string): Promise<string[]>;
  addTag(cardId: string, tag: string): Promise<boolean>;
  removeTag(cardId: string, tag: string): Promise<boolean>;
  setTags(cardId: string, tags: string[]): Promise<boolean>;
  getAllTags(): Promise<string[]>;
  showToast(message: string, type?: string, duration?: number): Promise<void>;
  getDatasetMeta(): Promise<Record<string, any>>;
  getAccessibilitySettings(): Promise<Record<string, any>>;
  setTheme(theme: 'light' | 'dark'): Promise<boolean>;
  getTheme(): Promise<string>;
  setTypography(preset: string): Promise<boolean>;
  getTypography(): Promise<string>;
  setHighContrast(enabled: boolean): Promise<boolean>;
  isHighContrast(): Promise<boolean>;
  prefersReducedMotion(): Promise<boolean>;
  getThemeVariables(): Promise<Record<string, any>>;
}

export interface StorageDriver {
  init(config?: any): Promise<void>;
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  getSize(): Promise<number>;
  getKind(): string;
}

export interface NavigationState {
  page: string;
  opts?: Record<string, any>;
}

// --- Validation Types (Tier 3) ---

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized: any | null;
}

export interface PluginValidatorClass {
  validate(plugin: { id: string; manifest: ModManifest; css?: string; js?: string }): ValidationResult;
  validateManifest(manifest: ModManifest): { errors: string[]; warnings: string[] };
  validateCSS(css: string): { errors: string[]; warnings: string[]; sanitized: string };
  validateJS(js: string): { errors: string[]; warnings: string[] };
}

// --- Permissions Types ---

export interface PermissionsClass {
  /** `fingerprint` (from computeFingerprint) binds the check to one plugin build. */
  hasPermission(pluginId: string, permission: PermissionType, fingerprint?: string): boolean;
  hasAllPermissions(pluginId: string, permissions: PermissionType[], fingerprint?: string): boolean;
  grantPermissions(pluginId: string, permissions: PermissionType[], fingerprint?: string): void;
  revokePermissions(pluginId: string, permissions?: PermissionType[]): void;
  getPermissions(pluginId: string): PermissionType[];
  /** The fingerprint a grant is bound to, or null for none/legacy/unbound. */
  getFingerprint(pluginId: string): string | null;
  /** Change-detection hash of a plugin's js + teardownJs + sorted manifest.permissions. */
  computeFingerprint(definition: { manifest?: { permissions?: string[] }; js?: string | null; teardownJs?: string | null }): string;
  requestPermissions(pluginId: string, pluginName: string, permissions: PermissionType[], fingerprint?: string): Promise<boolean>;
  clearAll(): void;
}

// --- Global Window Declaration ---

declare global {
  interface Window {
    /**
     * Public plugin surface, assembled and frozen by
     * www/src/core/global-api.js before any app-layer code runs.
     * Shape is a stability contract — see docs/architecture/PLUGIN_INVARIANTS.md.
     */
    CardSpoke: {
      /** Register AND enable a plugin (session-only; not persisted). */
      registerPlugin(id: string, definition: PluginDefinition): Promise<string>;
      /** Persistent install of a plugin package (alias of Plugin.install). */
      installPlugin(pkg: ModPackage): Promise<string>;
      requestPermissions(pluginId: string, pluginName: string, permissions: PermissionType[]): Promise<boolean>;
      Plugin: PluginClass;
      /**
       * Syntax-check a setup-body string (throws on invalid JS, otherwise
       * returns undefined). Does NOT execute the code and does not return a
       * callable — that changed in v0.21.0 (CS-002): real execution always
       * happens inside a plugin's own dedicated Worker now.
       */
      PluginSandbox: { createFunction(code: string): void };
      Middleware: MiddlewareManager;
      ComponentRegistry: ComponentRegistryClass;
      StorageDriverRegistry: StorageDriverRegistryClass;
      Permissions: PermissionsClass;
      PluginValidator: PluginValidatorClass;
      utils: PluginUtils;
    };
  }
}

export interface PluginClass {
  /** Validate, register, persist, and auto-enable (SAFE/LOW) a package. Returns the id. */
  install(pkg: ModPackage): Promise<string>;
  /** Rejects definitions whose only code is setup/teardown functions (use registerHostPlugin). */
  register(id: string, plugin: PluginDefinition): void;
  /** Host-only (non-enumerable): register trusted session-only function-form code. */
  registerHostPlugin(id: string, plugin: PluginDefinition): void;
  unregister(id: string): Promise<void>;
  get(id: string): PluginInstance | undefined;
  list(): PluginInstance[];
  listAll(): PluginInstance[];
  enable(id: string): Promise<void>;
  disable(id: string): Promise<void>;
  assessModRisk(pkg: ModPackage): 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH';
  /** Boot-time restore of persisted plugins. Idempotent. */
  syncFromStore(safeMode?: boolean): Promise<void>;
  notifyDataUpdate(event: DataUpdateEvent): void;
  buildSettingsPanel(id: string): HTMLElement | null;
  /** Plugin ids with a live Card component or card.render decorator registered. Empty in the common case. */
  getCardRenderPluginIds(): string[];
  /**
   * Ask one plugin's worker to render/decorate a batch of cards. Never
   * throws — resolves to `null` on timeout/error/missing worker, so
   * rendering.js can treat "no upgrade this pass" uniformly.
   */
  renderBatch(
    id: string,
    cardsSnapshot: Array<{ card: Card; isSelected?: boolean; tileSnapshot?: CardTileSnapshot }>,
    opts?: Record<string, any>
  ): Promise<Array<{ cardId: string; vnode: Vnode | null; patch: CardRenderPatch | null }> | null>;
}

export interface PluginDefinition {
  manifest: ModManifest;
  /** Session-only function form — host code, unsandboxed, runs on the main thread. Only string js/teardownJs persist across reloads AND are sandboxed. */
  setup?(ctx: PluginContext): void | Promise<void>;
  teardown?(ctx: PluginContext): void | Promise<void>;
  css?: string;
  js?: string;
  teardownJs?: string;
  overrides?: ModOverrides;
}

export interface PluginInstance {
  id: string;
  definition: PluginDefinition;
  /**
   * Only present for the legacy function-form (host-code) registration
   * path. `null` for every JS-bearing installed package (string `js`/
   * `teardownJs`) — its ctx is built fresh inside a dedicated Worker on
   * each enable and is not reachable from the host (v0.21.0, CS-002).
   */
  context: PluginContext | null;
  enabled: boolean;
  /** Present while enabled, for a JS-bearing plugin. Opaque — see PluginWorkerHandle in plugin-worker-manager.js. */
  workerHandle?: unknown;
  resources: Set<any>;
}

export interface MiddlewareManager {
  register(middleware: Middleware): void;
  unregister(name: string): void;
  run(operation: string, args: any[]): Promise<{ context: MiddlewareContext; prevented: boolean }>;
  list(): Array<{ name: string; priority: number; operations: string[] }>;
  clear(): void;
}

export interface ComponentRegistryClass {
  /** Returns false when a lower-priority registration is rejected. */
  register(name: string, component: Component, priority?: number): boolean;
  unregister(name: string): boolean;
  get(name: string): Component | undefined;
  resolve(name: string): Component | undefined;
  has(name: string): boolean;
  list(): Array<{ name: string; priority: number }>;
  clear(): void;
}

export interface StorageDriverRegistryClass {
  register(name: string, driver: StorageDriver): void;
  unregister(name: string): boolean;
  get(name: string): StorageDriver | undefined;
  setActive(name: string): Promise<void>;
  getActive(): StorageDriver;
}

/** Semantic DOM selector anchors available for plugin targeting */
export type PluginAnchor =
  | 'header'
  | 'header-inner'
  | 'brand'
  | 'save-status'
  | 'btn-undo'
  | 'btn-home'
  | 'btn-theme-toggle'
  | 'btn-menu'
  | 'menu-overlay'
  | 'menu-panel'
  | 'menu-new-card'
  | 'menu-plugin-manager'
  | 'breadcrumbs'
  | 'main-content'
  | 'search-container'
  | 'search-input'
  | 'toast-container'
  | 'footer';
