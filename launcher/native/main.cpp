#include "vector-scene.h"

#include <dwmapi.h>
#include <shellapi.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cmath>

int install(const fs::path& source, const fs::path& executable, const fs::path& profile, bool quiet);

namespace {
using Clock = std::chrono::steady_clock;
using Json = nlohmann::json;

constexpr wchar_t kWindowClass[] = L"DSHHelloWelcomeWindow";

Json read_json(const fs::path& path) {
    std::error_code error;
    if (fs::file_size(path, error) > 1024 * 1024 || error) return Json::object();
    std::ifstream input(path, std::ios::binary);
    if (!input) return Json::object();
    auto document = Json::parse(input, nullptr, false);
    return document.is_object() ? document : Json::object();
}

Json member(const Json& object, const char* key) {
    if (!object.is_object()) return {};
    const auto value = object.find(key);
    return value == object.end() ? Json() : *value;
}

std::string string_or(const Json& value, const char* fallback) {
    return value.is_string() ? value.get<std::string>() : fallback;
}

bool enabled(const Json& value) { return value != false; }

int integer_or(const Json& value, int fallback) {
    if (!value.is_number()) return fallback;
    const double number = value.get<double>();
    return std::isfinite(number) && std::abs(number) <= 32768 ? static_cast<int>(number) : fallback;
}

COLORREF background_color(const Json& settings) {
    const auto hex = string_or(member(settings, "background"), "");
    unsigned color = 0;
    if (hex.size() == 7 && hex.front() == '#') {
        const auto parsed = std::from_chars(hex.data() + 1, hex.data() + hex.size(), color, 16);
        if (parsed.ec == std::errc{} && parsed.ptr == hex.data() + hex.size()) {
            return RGB((color >> 16) & 255, (color >> 8) & 255, color & 255);
        }
    }
    return RGB(255, 255, 255);
}

bool bundle_enabled(const fs::path& profile) {
    const auto bundles = member(member(member(read_json(profile / L"package.json"), "dsh"), "profile"), "bundles");
    return bundles.is_array() && std::find(bundles.begin(), bundles.end(), "dsh-hello-splash") != bundles.end();
}

int width(const RECT& rect) { return rect.right - rect.left; }
int height(const RECT& rect) { return rect.bottom - rect.top; }

RECT initial_bounds(const fs::path& profile) {
    RECT work{};
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    const double dpi = GetDpiForSystem() / 96.0;
    auto state = read_json(profile.parent_path().parent_path() / L"desktop-window-state.json");
    const auto bounds = member(state, "bounds");
    const int w = integer_or(member(bounds, "width"), 0);
    const int h = integer_or(member(bounds, "height"), 0);
    if (w >= 400 && h >= 300) {
        const int x = integer_or(member(bounds, "x"), 0);
        const int y = integer_or(member(bounds, "y"), 0);
        RECT saved { std::lround(x * dpi), std::lround(y * dpi),
                     std::lround((x + w) * dpi), std::lround((y + h) * dpi) };
        if (auto monitor = MonitorFromRect(&saved, MONITOR_DEFAULTTONULL)) {
            if (member(state, "maximized") == true) {
                MONITORINFO info{};
                info.cbSize = sizeof(info);
                if (GetMonitorInfoW(monitor, &info)) return info.rcWork;
            }
            return saved;
        }
    }
    const int fallback_w = std::min(1320L, work.right - work.left);
    const int fallback_h = std::min(863L, work.bottom - work.top);
    const int x = work.left + (width(work) - fallback_w) / 2;
    const int y = work.top + (height(work) - fallback_h) / 2;
    return { x, y, x + fallback_w, y + fallback_h };
}

struct MainWindow {
    DWORD pid;
    RECT bounds{};
    bool found = false;
};

BOOL CALLBACK find_window(HWND window, LPARAM parameter) {
    auto& match = *reinterpret_cast<MainWindow*>(parameter);
    DWORD owner = 0;
    GetWindowThreadProcessId(window, &owner);
    RECT rect{};
    if (owner != match.pid || !IsWindowVisible(window) || IsIconic(window) ||
        !GetWindowRect(window, &rect) || width(rect) < 400 || height(rect) < 300) return TRUE;
    match.bounds = rect;
    match.found = true;
    return FALSE;
}

Handle start_dsh(const fs::path& executable, DWORD& pid) {
    auto command = quote(executable);
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", nullptr);
    if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, FALSE, 0, nullptr,
                        executable.parent_path().c_str(), &startup, &process)) return Handle();
    CloseHandle(process.hThread);
    pid = process.dwProcessId;
    return Handle(process.hProcess);
}

std::string launch_id() {
    GUID id{};
    if (FAILED(CoCreateGuid(&id))) return {};
    const auto* bytes = reinterpret_cast<const unsigned char*>(&id);
    constexpr char hex[] = "0123456789abcdef";
    std::string result;
    result.reserve(32);
    for (size_t i = 0; i < sizeof(id); ++i) {
        result += hex[bytes[i] >> 4];
        result += hex[bytes[i] & 15];
    }
    return result;
}

struct Handoff {
    fs::path request;
    fs::path ready;
    bool begun = false;

    bool begin(const fs::path& data, bool animated) {
        std::error_code error;
        fs::create_directories(data, error);
        const auto id = launch_id();
        if (error || id.empty()) return false;
        request = data / L"launch.request";
        ready = data / ("launch-ready-" + id);
        std::ofstream output(request, std::ios::binary | std::ios::trunc);
        begun = output.is_open();
        output << id << '\n' << (animated ? "animated" : "cover");
        output.close();
        return output.good();
    }

    ~Handoff() {
        if (!begun) return;
        std::error_code error;
        fs::remove(ready, error);
        fs::remove(request, error);
    }
};

struct Splash {
    HWND window = nullptr;
    HBRUSH background = nullptr;
    COLORREF key = RGB(1, 7, 13);
    RECT bounds{};
    VectorScene scene;
    Handoff handshake;
    Handle child;
    DWORD pid = 0;
    int duration = 3600;
    float time = 50;
    COLORREF canvas_color = RGB(255, 255, 255);
    bool painted = false;
    bool animated = false;
    bool escape = true;
    bool skipped = false;
    Clock::time_point started{};
    Clock::time_point fading{};

    ~Splash() { if (background) DeleteObject(background); }
    void opacity(BYTE alpha) const {
        SetLayeredWindowAttributes(window, key, alpha, LWA_COLORKEY | LWA_ALPHA);
    }
    void paint();
    void tick();
};

void Splash::paint() {
    PAINTSTRUCT paint{};
    const auto context = BeginPaint(window, &paint);
    RECT area{};
    GetClientRect(window, &area);
    if (animated && scene.paint(context, area, canvas_color, time)) painted = true;
    else if (!painted) FillRect(context, &area, background);
    EndPaint(window, &paint);
}

void Splash::tick() {
    const auto now = Clock::now();
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - started).count();
    if (WaitForSingleObject(child.get(), 0) == WAIT_OBJECT_0 || elapsed >= 18000) {
        DestroyWindow(window);
        return;
    }

    MainWindow host{pid};
    EnumWindows(find_window, reinterpret_cast<LPARAM>(&host));
    if (host.found && !EqualRect(&host.bounds, &bounds)) {
        bounds = host.bounds;
        SetWindowPos(window, HWND_TOPMOST, bounds.left, bounds.top, width(bounds), height(bounds), SWP_NOACTIVATE);
    }

    DWORD foreground = 0;
    GetWindowThreadProcessId(GetForegroundWindow(), &foreground);
    if (escape && (foreground == pid || foreground == GetCurrentProcessId()) && (GetAsyncKeyState(VK_ESCAPE) & 0x8000)) {
        skipped = true;
    }

    const float scene_time = std::min(float(elapsed) * 3600 / duration, artwork::kLogoHold);
    if (animated && !skipped && fading == Clock::time_point{} && scene_time > time) {
        time = scene_time;
        InvalidateRect(window, nullptr, FALSE);
    }

    std::error_code error;
    if (fading == Clock::time_point{} && host.found && fs::exists(handshake.ready, error)) {
        if (!animated) {
            DestroyWindow(window);
            return;
        }
        if (time >= artwork::kLogoHold || skipped) fading = now;
    }
    if (fading != Clock::time_point{}) {
        const double fade = std::chrono::duration<double, std::milli>(now - fading).count();
        const double span = duration * (3600.0 - artwork::kLogoHold) / 3600;
        if (fade >= span) DestroyWindow(window);
        else opacity(static_cast<BYTE>((1 - fade / span) * 255));
    }
}

LRESULT CALLBACK window_proc(HWND window, UINT event, WPARAM wparam, LPARAM lparam) {
    auto* splash = reinterpret_cast<Splash*>(GetWindowLongPtrW(window, GWLP_USERDATA));
    if (event == WM_NCCREATE) {
        const auto* info = reinterpret_cast<CREATESTRUCTW*>(lparam);
        splash = static_cast<Splash*>(info->lpCreateParams);
        splash->window = window;
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(splash));
    }
    if (splash) {
        switch (event) {
        case WM_PAINT: splash->paint(); return 0;
        case WM_ERASEBKGND: return 1;
        case WM_TIMER: splash->tick(); return 0;
        case WM_DESTROY: KillTimer(window, 1); PostQuitMessage(0); return 0;
        }
    }
    return DefWindowProcW(window, event, wparam, lparam);
}

void play(const fs::path& executable, const fs::path& profile) {
    SetProcessDPIAware();
    const auto data = plugin_data(profile);
    const auto settings = read_json(data / L"config.json");
    BOOL animation = TRUE;
    SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &animation, 0);
    if (running(executable) || !bundle_enabled(profile) || !enabled(member(settings, "enabled")) || !animation) {
        DWORD pid;
        if (!start_dsh(executable, pid)) message(L"无法打开 DSH Next，请检查应用路径。");
        return;
    }

    Splash splash;
    const auto bg = background_color(settings);
    splash.background = CreateSolidBrush(bg);
    splash.canvas_color = bg;
    if (bg == splash.key) splash.key = RGB(2, 8, 14);
    splash.bounds = initial_bounds(profile);
    splash.duration = std::clamp(integer_or(member(settings, "duration"), 3600), 3000, 4000);
    splash.escape = enabled(member(settings, "escSkip"));
    splash.animated = string_or(member(settings, "text"), "Welcome to DSH.") == "Welcome to DSH." &&
        splash.scene.initialize(enabled(member(settings, "morph")), enabled(member(settings, "subtitle")));

    WNDCLASSW info{};
    info.lpfnWndProc = window_proc;
    info.lpszClassName = kWindowClass;
    info.hInstance = GetModuleHandleW(nullptr);
    info.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&info);
    if (!splash.handshake.begin(data, splash.animated)) {
        DWORD pid;
        if (!start_dsh(executable, pid)) message(L"无法打开 DSH Next，请检查应用路径。");
        return;
    }

    const auto bounds = splash.bounds;
    if (!CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            kWindowClass, L"DSH Next 启动动画", WS_POPUP, bounds.left, bounds.top, width(bounds), height(bounds),
            nullptr, nullptr, info.hInstance, &splash)) {
        DWORD pid;
        if (!start_dsh(executable, pid)) message(L"无法打开 DSH Next，请检查应用路径。");
        return;
    }
    splash.opacity(255);
    ShowWindow(splash.window, SW_SHOW);
    UpdateWindow(splash.window);
    DwmFlush();

    splash.started = Clock::now();
    splash.child = start_dsh(executable, splash.pid);
    if (!splash.child) {
        DestroyWindow(splash.window);
        message(L"无法打开 DSH Next，请检查应用路径。");
        return;
    }
    if (!SetTimer(splash.window, 1, 15, nullptr)) {
        DestroyWindow(splash.window);
        return;
    }
    MSG event{};
    while (GetMessageW(&event, nullptr, 0, 0) > 0) {
        TranslateMessage(&event);
        DispatchMessageW(&event);
    }
}
} // namespace

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    int count = 0;
    auto* args = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!args) return 1;
    const bool initialize = SUCCEEDED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED));
    int result = 0;
    try {
        if (count >= 2 && std::wstring_view(args[1]) == L"--install") {
            const bool quiet = count >= 3 && std::wstring_view(args[2]) == L"--quiet";
            const int offset = quiet ? 3 : 2;
            const fs::path default_app = fs::path(environment(L"LOCALAPPDATA")) / L"Programs" / L"DSH NEXT" / L"DSH NEXT.exe";
            const auto dsh_home = environment(L"DSH_HOME");
            const fs::path home = dsh_home.empty() ? fs::path(environment(L"USERPROFILE")) / L".dsh" : fs::path(dsh_home);
            const fs::path app = count > offset ? fs::path(args[offset]) : default_app;
            const fs::path profile = count > offset + 1 ? fs::path(args[offset + 1]) : home / L"profiles" / L"desktop";
            result = install(program_file().parent_path(), app, profile, quiet);
        } else if (count == 3) {
            SetLastError(ERROR_SUCCESS);
            Handle guard(CreateMutexW(nullptr, FALSE, L"Local\\DSH-Hello-Splash-White-Launch"));
            if (!guard) {
                message(L"无法创建 DSH Next 启动器。");
                result = 1;
            } else if (GetLastError() != ERROR_ALREADY_EXISTS) {
                play(args[1], args[2]);
            }
        } else {
            message(L"双击安装.cmd 安装，之后使用桌面的 DSH Next 快捷方式。", MB_OK | MB_ICONINFORMATION);
        }
    } catch (const std::exception&) {
        message(L"启动动画遇到文件或配置错误。请检查 DSH Next 和当前 Profile 后重试。");
        result = 1;
    }
    if (initialize) CoUninitialize();
    LocalFree(args);
    return result;
}


