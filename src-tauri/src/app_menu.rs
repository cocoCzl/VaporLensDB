use tauri::{
    menu::{
        AboutMetadata, MenuBuilder, MenuEvent, MenuItem, PredefinedMenuItem, SubmenuBuilder,
        HELP_SUBMENU_ID,
    },
    AppHandle, Emitter, Manager, Runtime,
};

const EDIT_SUBMENU_ID: &str = "vaporlensdb-edit-menu";
const APP_WINDOW_SUBMENU_ID: &str = "vaporlensdb-window-menu";

const WINDOW_MINIMIZE_ID: &str = "vaporlensdb-window-minimize";
const WINDOW_ZOOM_ID: &str = "vaporlensdb-window-zoom";
const WINDOW_BRING_ALL_TO_FRONT_ID: &str = "vaporlensdb-window-bring-all-to-front";
const FILE_NEW_SQL_ID: &str = "vaporlensdb-file-new-sql";
const FILE_NEW_CONNECTION_ID: &str = "vaporlensdb-file-new-connection";
const FILE_CLOSE_TAB_ID: &str = "vaporlensdb-file-close-tab";
const DATABASE_MANAGE_ID: &str = "vaporlensdb-database-manage";
const DATABASE_REFRESH_ID: &str = "vaporlensdb-database-refresh";
const DATABASE_CONNECT_ID: &str = "vaporlensdb-database-connect";
const VIEW_COMMAND_PALETTE_ID: &str = "vaporlensdb-view-command-palette";
const VIEW_QUERY_HISTORY_ID: &str = "vaporlensdb-view-query-history";
const VIEW_SETTINGS_ID: &str = "vaporlensdb-view-settings";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMenuLanguage {
    Zh,
    En,
}

impl AppMenuLanguage {
    pub fn from_code(value: &str) -> Self {
        if value.to_ascii_lowercase().starts_with("en") {
            Self::En
        } else {
            Self::Zh
        }
    }
}

pub fn set_application_menu<R: Runtime>(
    app: &AppHandle<R>,
    language: AppMenuLanguage,
) -> tauri::Result<()> {
    let labels = labels(language);
    let about_metadata = about_metadata(app);
    let app_menu = SubmenuBuilder::new(app, "VaporLensDB")
        .about_with_text(labels.about, Some(about_metadata.clone()))
        .separator()
        .hide_with_text(labels.hide)
        .hide_others_with_text(labels.hide_others)
        .show_all_with_text(labels.show_all)
        .separator()
        .quit_with_text(labels.quit)
        .build()?;
    let file_new_sql = menu_item(app, FILE_NEW_SQL_ID, labels.new_sql, "CmdOrCtrl+N")?;
    let file_new_connection = menu_item(
        app,
        FILE_NEW_CONNECTION_ID,
        labels.new_connection,
        "CmdOrCtrl+Shift+N",
    )?;
    let file_close_tab = menu_item(app, FILE_CLOSE_TAB_ID, labels.close_tab, "CmdOrCtrl+W")?;
    let database_connect = menu_item(
        app,
        DATABASE_CONNECT_ID,
        labels.connect,
        "CmdOrCtrl+Shift+C",
    )?;
    let database_refresh = menu_item(app, DATABASE_REFRESH_ID, labels.refresh, "CmdOrCtrl+R")?;
    let database_manage = menu_item(
        app,
        DATABASE_MANAGE_ID,
        labels.manage_data_sources,
        "CmdOrCtrl+Shift+Comma",
    )?;
    let view_command_palette = menu_item(
        app,
        VIEW_COMMAND_PALETTE_ID,
        labels.command_palette,
        "CmdOrCtrl+K",
    )?;
    let view_query_history = menu_item(
        app,
        VIEW_QUERY_HISTORY_ID,
        labels.query_history,
        "CmdOrCtrl+Shift+H",
    )?;
    let view_settings = menu_item(app, VIEW_SETTINGS_ID, labels.settings, "CmdOrCtrl+,")?;
    let file_menu = SubmenuBuilder::new(app, labels.file)
        .item(&file_new_sql)
        .item(&file_new_connection)
        .separator()
        .item(&file_close_tab)
        .separator()
        .close_window_with_text(labels.close_window)
        .build()?;
    let undo_item = PredefinedMenuItem::undo(app, Some(labels.undo))?;
    let redo_item = PredefinedMenuItem::redo(app, Some(labels.redo))?;
    let cut_item = PredefinedMenuItem::cut(app, Some(labels.cut))?;
    let copy_item = PredefinedMenuItem::copy(app, Some(labels.copy))?;
    let paste_item = PredefinedMenuItem::paste(app, Some(labels.paste))?;
    let select_all_item = PredefinedMenuItem::select_all(app, Some(labels.select_all))?;
    let minimize_item = menu_item(app, WINDOW_MINIMIZE_ID, labels.minimize, "CmdOrCtrl+M")?;
    let zoom_item = menu_item(app, WINDOW_ZOOM_ID, labels.zoom, "CmdOrCtrl+Shift+M")?;
    let bring_all_to_front_item = MenuItem::with_id(
        app,
        WINDOW_BRING_ALL_TO_FRONT_ID,
        labels.bring_all_to_front,
        true,
        None::<&str>,
    )?;

    let edit_menu = SubmenuBuilder::with_id(app, EDIT_SUBMENU_ID, labels.edit)
        .item(&undo_item)
        .item(&redo_item)
        .separator()
        .item(&cut_item)
        .item(&copy_item)
        .item(&paste_item)
        .item(&select_all_item)
        .build()?;
    let database_menu = SubmenuBuilder::new(app, labels.database)
        .item(&database_connect)
        .item(&database_refresh)
        .separator()
        .item(&database_manage)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, labels.view)
        .item(&view_command_palette)
        .item(&view_query_history)
        .item(&view_settings)
        .separator()
        .fullscreen_with_text(labels.toggle_full_screen)
        .build()?;
    let window_menu = SubmenuBuilder::with_id(app, APP_WINDOW_SUBMENU_ID, labels.window)
        .item(&minimize_item)
        .item(&zoom_item)
        .separator()
        .item(&bring_all_to_front_item)
        .build()?;
    let help_menu = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, labels.help)
        .about_with_text(labels.help_about, Some(about_metadata))
        .build()?;
    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&database_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    let id = event.id().0.as_str();
    match id {
        FILE_NEW_SQL_ID => emit_workspace_command(app, "new-sql"),
        FILE_NEW_CONNECTION_ID => emit_workspace_command(app, "new-connection"),
        FILE_CLOSE_TAB_ID => emit_workspace_command(app, "close-tab"),
        DATABASE_CONNECT_ID => emit_workspace_command(app, "connect-browsing-data-source"),
        DATABASE_REFRESH_ID => emit_workspace_command(app, "refresh-browsing-data-source"),
        DATABASE_MANAGE_ID => emit_workspace_command(app, "manage-data-sources"),
        VIEW_COMMAND_PALETTE_ID => emit_workspace_command(app, "command-palette"),
        VIEW_QUERY_HISTORY_ID => emit_workspace_command(app, "query-history"),
        VIEW_SETTINGS_ID => emit_workspace_command(app, "settings"),
        WINDOW_MINIMIZE_ID => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.minimize();
            }
        }
        WINDOW_ZOOM_ID => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_maximized().unwrap_or(false) {
                    let _ = window.unmaximize();
                } else {
                    let _ = window.maximize();
                }
            }
        }
        WINDOW_BRING_ALL_TO_FRONT_ID => {
            for window in app.webview_windows().values() {
                let _ = window.set_focus();
            }
        }
        _ => {}
    }
}

fn emit_workspace_command<R: Runtime>(app: &AppHandle<R>, command: &str) {
    let _ = app.emit("vaporlensdb:workspace-command", command);
}

fn menu_item<R: Runtime>(
    app: &AppHandle<R>,
    id: &'static str,
    text: &'static str,
    accelerator: &'static str,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, true, Some(accelerator))
}

fn about_metadata<R: Runtime>(app: &AppHandle<R>) -> AboutMetadata<'static> {
    let package_info = app.package_info();
    AboutMetadata {
        name: Some(package_info.name.clone()),
        version: Some(package_info.version.to_string()),
        ..Default::default()
    }
}

struct AppMenuLabels {
    about: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    file: &'static str,
    database: &'static str,
    new_sql: &'static str,
    new_connection: &'static str,
    close_tab: &'static str,
    connect: &'static str,
    refresh: &'static str,
    manage_data_sources: &'static str,
    command_palette: &'static str,
    query_history: &'static str,
    settings: &'static str,
    close_window: &'static str,
    edit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    view: &'static str,
    toggle_full_screen: &'static str,
    window: &'static str,
    minimize: &'static str,
    zoom: &'static str,
    bring_all_to_front: &'static str,
    help: &'static str,
    help_about: &'static str,
}

fn labels(language: AppMenuLanguage) -> AppMenuLabels {
    match language {
        AppMenuLanguage::Zh => AppMenuLabels {
            about: "关于 VaporLensDB",
            hide: "隐藏 VaporLensDB",
            hide_others: "隐藏其他",
            show_all: "全部显示",
            quit: "退出 VaporLensDB",
            file: "文件",
            database: "数据库",
            new_sql: "新建 SQL",
            new_connection: "新建数据源",
            close_tab: "关闭标签页",
            connect: "连接浏览数据源",
            refresh: "刷新浏览数据源",
            manage_data_sources: "管理数据源",
            command_palette: "命令面板",
            query_history: "查询历史",
            settings: "设置",
            close_window: "关闭窗口",
            edit: "编辑",
            undo: "撤销",
            redo: "重做",
            cut: "剪切",
            copy: "复制",
            paste: "粘贴",
            select_all: "全选",
            view: "显示",
            toggle_full_screen: "切换全屏",
            window: "窗口",
            minimize: "最小化",
            zoom: "缩放",
            bring_all_to_front: "全部前置",
            help: "帮助",
            help_about: "关于 VaporLensDB",
        },
        AppMenuLanguage::En => AppMenuLabels {
            about: "About VaporLensDB",
            hide: "Hide VaporLensDB",
            hide_others: "Hide Others",
            show_all: "Show All",
            quit: "Quit VaporLensDB",
            file: "File",
            database: "Database",
            new_sql: "New SQL",
            new_connection: "New Data Source",
            close_tab: "Close Tab",
            connect: "Connect Browsing Data Source",
            refresh: "Refresh Browsing Data Source",
            manage_data_sources: "Manage Data Sources",
            command_palette: "Command Palette",
            query_history: "Query History",
            settings: "Settings",
            close_window: "Close Window",
            edit: "Edit",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            view: "View",
            toggle_full_screen: "Toggle Full Screen",
            window: "Window",
            minimize: "Minimize",
            zoom: "Zoom",
            bring_all_to_front: "Bring All to Front",
            help: "Help",
            help_about: "About VaporLensDB",
        },
    }
}
