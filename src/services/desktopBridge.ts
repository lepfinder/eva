import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

type AnyFn = (...args: any[]) => any

const NOOP_UNSUBSCRIBE = (): void => {}

const DEFAULTS: Record<string, any> = {
  settingsGetAll: {},
  getNavigationData: { navigationItems: [] },
  getIconList: [],
  storageGetStats: { total: 0, totalFormatted: '0 B', items: [] },
  'hotkeys.getAll': [],
  'clipboard.getItems': [],
  'clipboard.searchItems': [],
  'clipboard.getStats': { total: 0, images: 0, text: 0, files: 0 },
  'skills.list': [],
  'skills.catalog': [],
  getListeningPorts: [],
  getMemoryAnalysis: { system: { total: 0, used: 0, available: 0, percent: 0, swapTotal: 0, swapUsed: 0 }, apps: [] },
  'env.detect': [],
  'visual_recall_search_snapshots': { snapshots: [], total: 0 },
  'visual_recall_get_config': { enabled: false, intervalSecs: 10, maxStorageMb: 2048 },
}

function readDefault(path: string): any {
  if (DEFAULTS[path] !== undefined) return DEFAULTS[path]

  const method = path.split('.').pop() || ''
  if (method.startsWith('on')) return NOOP_UNSUBSCRIBE
  if (method.startsWith('get') || method.startsWith('list') || method.startsWith('search')) return []

  return { success: false, message: `Unimplemented API method: ${path}` }
}

function createStub(path: string[] = []): AnyFn {
  const callable: AnyFn = (..._args: any[]) => {
    const fullPath = path.join('.')
    const fallback = readDefault(fullPath)

    if (typeof fallback === 'function') {
      return fallback
    }

    return Promise.resolve(fallback)
  }

  return new Proxy(callable, {
    get(_target, prop: string | symbol) {
      if (prop === 'then') return undefined
      return createStub([...path, String(prop)])
    },
    apply(_target, _thisArg, argArray) {
      return callable(...argArray)
    }
  })
}

// Navigation methods wired to real Tauri commands
const navigationApi: Record<string, AnyFn> = {
  getNavigationData: () => invoke('get_navigation_data'),
  saveNavigationData: (data: any) => invoke('save_navigation_data', { data }),
  getNavigationDataDir: () => invoke('get_navigation_data_dir'),
  getNavIconData: (iconName: string) => invoke('get_nav_icon_data', { iconName }),
  getIconList: () => invoke('get_icon_list'),
  deleteIcon: (iconName: string) => invoke('delete_icon', { iconName }),
  deleteIcons: (iconNames: string[]) => invoke('delete_icons', { iconNames }),
  openNavLinkInBrowser: (url: string, browser: string) =>
    invoke('open_nav_link_in_browser', { url, browser }),
  fetchSiteInfo: (url: string) => invoke('fetch_site_info', { url }),
  downloadFavicon: (url: string, source: string) =>
    invoke('download_favicon', { url, source }),
  addNavigationItem: (categoryId: string, subCategoryId: string | null, item: any) =>
    invoke('add_navigation_item', { categoryId, subCategoryId, item }),
  updateNavigationItem: (
    categoryId: string,
    subCategoryId: string | null,
    itemId: string,
    updates: any
  ) => invoke('update_navigation_item', { categoryId, subCategoryId, itemId, updates }),
  removeNavigationItem: (categoryId: string, subCategoryId: string | null, itemId: string) =>
    invoke('remove_navigation_item', { categoryId, subCategoryId, itemId }),
  moveNavigationItem: (
    fromCategoryId: string,
    fromSubCategoryId: string | null,
    itemId: string,
    toCategoryId: string,
    toSubCategoryId: string | null
  ) =>
    invoke('move_navigation_item', {
      fromCategoryId,
      fromSubCategoryId,
      itemId,
      toCategoryId,
      toSubCategoryId,
    }),
  addCategory: (category: any) => invoke('add_category', { category }),
  updateCategory: (categoryId: string, updates: any) =>
    invoke('update_category', { categoryId, updates }),
  removeCategory: (categoryId: string) => invoke('remove_category', { categoryId }),
  addSubCategory: (categoryId: string, subCategory: any) =>
    invoke('add_sub_category', { categoryId, subCategory }),
  updateSubCategory: (categoryId: string, subCategoryId: string, updates: any) =>
    invoke('update_sub_category', { categoryId, subCategoryId, updates }),
  removeSubCategory: (categoryId: string, subCategoryId: string) =>
    invoke('remove_sub_category', { categoryId, subCategoryId }),
  reorderCategories: (categoryIds: string[]) =>
    invoke('reorder_categories', { categoryIds }),
  reorderSubCategories: (categoryId: string, subCategoryIds: string[]) =>
    invoke('reorder_sub_categories', { categoryId, subCategoryIds }),
  importNavigationData: (sourcePath: string) =>
    invoke('import_navigation_data', { sourcePath }),
}

// Settings / storage methods wired to real Tauri commands
const settingsApi: Record<string, AnyFn> = {
  getDataPath: () => invoke('get_data_dir'),
  storageGetStats: () => invoke('get_storage_stats'),
  openInFinder: (path: string) => invoke('open_in_finder', { path }),
}

// Toolbox: LocalPorts
const toolsApi: Record<string, AnyFn> = {
  getListeningPorts: () => invoke('get_listening_ports'),
  killProcess: (pid: number) => invoke('kill_process', { pid }),
  openInBrowser: (url: string) => invoke('open_url_in_browser', { url }),
  getMemoryAnalysis: () => invoke('get_memory_analysis'),
}

// Toolbox: EnvDetector nested APIs
const envApi: Record<string, AnyFn> = {
  detect: () => invoke('env_detect'),
  saveDescription: (id: string, description: string) =>
    invoke('env_save_description', { id, description }),
}

// app.openInFinder (used by EnvDetector detail dialog)
const appApi: Record<string, AnyFn> = {
  openInFinder: (path: string) => invoke('open_in_finder', { path }),
}

// Clipboard history
const clipboardApi: Record<string, AnyFn> = {
  getItems: (limit?: number, offset?: number, dateFilter?: string) =>
    invoke('clipboard_get_items', { limit, offset, dateFilter }),
  searchItems: (query: string, limit?: number, dateFilter?: string) =>
    invoke('clipboard_search_items', { query, limit, dateFilter }),
  deleteItem: (id: string) => invoke('clipboard_delete_item', { id }),
  clearAll: () => invoke('clipboard_clear_all'),
  writeToClipboard: (id: string) => invoke('clipboard_write_to_clipboard', { id }),
  getStats: () => invoke('clipboard_get_stats'),
  getDailyStats: () => invoke('clipboard_get_daily_stats'),
  // Real-time push: listen for clipboard:newItem Tauri events
  onNewItem: (callback: (item: any) => void) => {
    let unlisten: (() => void) | null = null
    listen('clipboard:newItem', (event: any) => {
      callback(event.payload)
    }).then((fn: () => void) => {
      unlisten = fn
    })
    return () => {
      if (unlisten) unlisten()
    }
  },
}

const onClipboardUrlDetected = (callback: (url: string) => void) => {
  let unlisten: (() => void) | null = null
  listen('clipboard:url-detected', (event: any) => {
    callback(event.payload)
  }).then((fn: () => void) => {
    unlisten = fn
  })
  return () => {
    if (unlisten) unlisten()
  }
}

// Vault
const vaultApi: Record<string, AnyFn> = {
  vaultCanUseBiometric: () => invoke('vault_can_use_biometric'),
  vaultUnlock: async () => {
    try {
      // 先弹出 Touch ID 窗口（Rust 侧同步等待结果）
      const ok = await invoke<boolean>('vault_prompt_biometric', { reason: '解锁 EVA 保险箱' })
      if (!ok) {
        // 用户取消或失败 → 回退到密码
        return { success: false, needPassword: true }
      }
      return invoke('vault_unlock_with_biometric')
    } catch {
      return { success: false, needPassword: true }
    }
  },
  vaultHasPassword: () => invoke('vault_has_password'),
  vaultUnlockWithPassword: (password: string) =>
    invoke('vault_unlock_with_password', { password }),
  vaultSetPassword: (password: string) => invoke('vault_set_password', { password }),
  vaultLock: () => invoke('vault_lock'),
  vaultSave: (data: any) => invoke('vault_save', { data }),
  vaultSetContentProtection: (_enabled: boolean) => Promise.resolve(), // no-op in Eva
}

// Activity Tracker
const activityApi: Record<string, AnyFn> = {
  getTodayStats: (date?: string) => invoke('activity_get_today_stats', { date }),
  getTodayLogs: (date?: string) => invoke('activity_get_today_logs', { date }),
  getTodayTotalDuration: (date?: string) => invoke('activity_get_today_total_duration', { date }),
  getStatsByCategory: (date?: string) => invoke('activity_get_stats_by_category', { date }),
  getStatsByProject: (date?: string) => invoke('activity_get_stats_by_project', { date }),
  getTodayLogsCount: (date?: string) => invoke('activity_get_today_logs_count', { date }),
  getDailySummary: (date: string) => invoke('activity_get_daily_summary', { date }),
  updateRemark: (id: string, remark: string | null) => invoke('activity_update_remark', { id, remark }),
  classifyNow: () => invoke('activity_classify_now'),
  generateSummary: (date: string) => invoke('activity_generate_summary', { date }),
  getHeatmapData: (year: number) => invoke('activity_get_heatmap_data', { year }),
  rebuildDailyStats: () => invoke('activity_rebuild_daily_stats'),
}

// HTTP API Server
const httpServerApi: Record<string, AnyFn> = {
  getConfig: () => invoke('http_server_get_config'),
  saveConfig: (config: any) => invoke('http_server_save_config', { config }),
  generateToken: () => invoke('http_server_generate_token'),
}

export function initDesktopBridge(): void {
  if ((window as any).api) return
  // Merge: implemented methods call real Tauri commands; rest fall through to stub defaults.
  const stub = createStub() as any
  ;(window as any).api = new Proxy(stub, {
    get(_target, prop: string | symbol) {
      const key = String(prop)
      if (key in navigationApi) return navigationApi[key]
      if (key in settingsApi) return settingsApi[key]
      if (key in toolsApi) return toolsApi[key]
      if (key in vaultApi) return vaultApi[key]
      if (key === 'env') return envApi
      if (key === 'app') return appApi
      if (key === 'clipboard') return clipboardApi
      if (key === 'onClipboardUrlDetected') return onClipboardUrlDetected
      if (key === 'activity') return activityApi
      if (key === 'httpServer') return httpServerApi
      return stub[key]
    },
  })
}
