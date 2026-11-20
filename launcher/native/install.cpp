#include "support.h"

#include <shlobj.h>
#include <shobjidl.h>

#include <array>
#include <cwchar>
#include <initializer_list>

namespace {
constexpr wchar_t kLauncher[] = L"DSHNextWelcome.exe";
constexpr wchar_t kPackage[] = L"dsh-hello-splash-1.4.1.tgz";

bool is_our_shortcut(const fs::path& path) {
    Com<IShellLinkW> link;
    if (!fs::exists(path) || FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
            IID_IShellLinkW, reinterpret_cast<void**>(link.put())))) return false;
    Com<IPersistFile> file;
    if (FAILED(link->QueryInterface(IID_IPersistFile, reinterpret_cast<void**>(file.put()))) ||
        FAILED(file->Load(path.c_str(), STGM_READ))) return false;

    std::array<wchar_t, 32768> buffer{};
    if (SUCCEEDED(link->GetPath(buffer.data(), buffer.size(), nullptr, SLGP_RAWPATH)) &&
        _wcsicmp(fs::path(buffer.data()).filename().c_str(), kLauncher) == 0) return true;
    if (FAILED(link->GetArguments(buffer.data(), buffer.size()))) return false;
    const std::wstring_view args(buffer.data());
    return args.find(L"dsh-hello-splash") != args.npos && args.find(L"white-launch.pyw") != args.npos;
}

bool make_shortcut(const fs::path& launcher, const fs::path& app, const fs::path& profile, fs::path& shortcut) {
    PWSTR desktop = nullptr;
    if (FAILED(SHGetKnownFolderPath(FOLDERID_Desktop, 0, nullptr, &desktop))) return false;
    const fs::path folder(desktop);
    CoTaskMemFree(desktop);
    shortcut = folder / L"DSH Next 白色启动.lnk";
    const auto standard = folder / L"DSH Next.lnk";
    if (is_our_shortcut(standard)) shortcut = standard;

    Com<IShellLinkW> link;
    if (FAILED(CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
            IID_IShellLinkW, reinterpret_cast<void**>(link.put())))) return false;
    const auto arguments = quote(app) + L" " + quote(profile);
    if (FAILED(link->SetPath(launcher.c_str())) ||
        FAILED(link->SetArguments(arguments.c_str())) ||
        FAILED(link->SetWorkingDirectory(launcher.parent_path().c_str())) ||
        FAILED(link->SetIconLocation(app.c_str(), 0)) ||
        FAILED(link->SetDescription(L"打开即播放欢迎动画，DSH Next 同时在后台初始化"))) return false;
    Com<IPersistFile> file;
    return SUCCEEDED(link->QueryInterface(IID_IPersistFile, reinterpret_cast<void**>(file.put()))) &&
        SUCCEEDED(file->Save(shortcut.c_str(), TRUE));
}

DWORD install_bundle(const fs::path& app, const fs::path& cli, const fs::path& profile,
                     const fs::path& package, const fs::path& log) {
    SECURITY_ATTRIBUTES inherit{sizeof(inherit), nullptr, TRUE};
    Handle output(CreateFileW(log.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &inherit, CREATE_ALWAYS,
                              FILE_ATTRIBUTE_NORMAL, nullptr));
    Handle input(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ, &inherit, OPEN_EXISTING, 0, nullptr));
    if (!output || !input) return GetLastError();

    auto command = quote(app) + L" " + quote(cli) + L" plugin --profile " + quote(profile.filename()) +
                   L" add " + quote(package) + L" --offline";
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = input.get();
    startup.hStdOutput = output.get();
    startup.hStdError = output.get();
    PROCESS_INFORMATION process{};
    SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1");
    const bool booted = CreateProcessW(app.c_str(), command.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW,
                                      nullptr, profile.c_str(), &startup, &process);
    const DWORD error = GetLastError();
    SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", nullptr);
    if (!booted) return error;

    Handle child(process.hProcess), thread(process.hThread);
    if (WaitForSingleObject(child.get(), INFINITE) != WAIT_OBJECT_0) return GetLastError();
    DWORD result = 1;
    return GetExitCodeProcess(child.get(), &result) ? result : GetLastError();
}

void copy_asset(const fs::path& source, const fs::path& destination) {
    // Keep the previous installed file usable if copying is interrupted.
    if (fs::exists(destination) && fs::equivalent(source, destination)) return;
    auto temporary = destination;
    temporary += L".installing";
    fs::copy_file(source, temporary, fs::copy_options::overwrite_existing);
    if (!MoveFileExW(temporary.c_str(), destination.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        const auto error = GetLastError();
        std::error_code ignored;
        fs::remove(temporary, ignored);
        throw std::system_error(error, std::system_category());
    }
}
} // namespace

int install(const fs::path& source, const fs::path& executable, const fs::path& profile, bool quiet) {
    const auto fail = [quiet](const std::wstring& detail, int code = 1) {
        if (!quiet) message(detail);
        return code;
    };

    try {
        const auto app = fs::absolute(executable).lexically_normal();
        const auto target_profile = fs::absolute(profile).lexically_normal();
        if (!fs::is_regular_file(app)) return fail(L"找不到 DSH Next。请先安装 DSH Next。");
        if (!fs::is_regular_file(target_profile / L"package.json")) {
            return fail(L"找不到 desktop Profile。请先打开一次 DSH Next，再完全退出并安装。");
        }
        for (const auto* asset : { kLauncher, kPackage }) {
            if (!fs::is_regular_file(source / asset)) {
                return fail(std::wstring(L"安装文件不完整。请先解压完整安装包。\n缺少 ") + asset);
            }
        }
        const auto resources = app.parent_path() / L"resources";
        auto cli = resources / L"app" / L"lib" / L"desktop-cli.js";
        if (!fs::is_regular_file(cli)) {
            if (!fs::is_regular_file(resources / L"app.asar")) return fail(L"找不到 DSH 自带的插件安装程序。");
            cli = resources / L"app.asar" / L"lib" / L"desktop-cli.js";
        }
        while (running(app)) {
            if (quiet || MessageBoxW(nullptr,
                L"DSH Next 正在运行。请在 DSH 的「应用」菜单点「退出」，然后点击重试。",
                L"DSH Next 启动动画", MB_RETRYCANCEL | MB_ICONINFORMATION) != IDRETRY) return 2;
        }

        const auto data = plugin_data(target_profile);
        const auto launcher = data / L"launcher";
        const auto packages = data / L"packages";
        fs::create_directories(launcher);
        fs::create_directories(packages);
        copy_asset(source / kPackage, packages / kPackage);
        const auto log = data / L"install.log";
        const DWORD result = install_bundle(app, cli, target_profile, packages / kPackage, log);
        if (result != 0) {
            return fail(L"DSH 插件安装失败，退出代码 " + std::to_wstring(result) + L"。\n安装记录位于\n" + log.wstring());
        }
        copy_asset(source / kLauncher, launcher / kLauncher);
        fs::path shortcut;
        if (!make_shortcut(launcher / kLauncher, app, target_profile, shortcut)) {
            return fail(L"已安装插件和启动器，创建桌面快捷方式失败。");
        }
        if (!quiet) {
            message(L"安装完成。请用桌面上的「" + shortcut.stem().wstring() + L"」启动 DSH Next。", MB_OK | MB_ICONINFORMATION);
        }
        return 0;
    } catch (const fs::filesystem_error& error) {
        return fail(L"复制安装文件时出错。请检查安装包及 Profile 路径。\n" + error.path1().wstring());
    } catch (const std::system_error& error) {
        return fail(L"Windows 未能写入安装文件，错误代码 " + std::to_wstring(error.code().value()) + L"。");
    }
}



