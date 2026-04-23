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
  getItems: (limit?: number, offset?: number) =>
    invoke('clipboard_get_items', { limit, offset }),
  searchItems: (query: string, limit?: number) =>
    invoke('clipboard_search_items', { query, limit }),
  deleteItem: (id: string) => invoke('clipboard_delete_item', { id }),
  clearAll: () => invoke('clipboard_clear_all'),
  writeToClipboard: (id: string) => invoke('clipboard_write_to_clipboard', { id }),
  getStats: () => invoke('clipboard_get_stats'),
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
      if (key === 'env') return envApi
      if (key === 'app') return appApi
      if (key === 'clipboard') return clipboardApi
      return stub[key]
    },
  })
}
