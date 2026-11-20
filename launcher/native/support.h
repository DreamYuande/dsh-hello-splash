#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <tlhelp32.h>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <utility>

namespace fs = std::filesystem;

template<class T> class Com {
public:
    Com() = default;
    Com(const Com&) = delete;
    Com& operator=(const Com&) = delete;
    ~Com() { if (ptr_) ptr_->Release(); }
    T* operator->() const { return ptr_; }
    T* get() const { return ptr_; }
    void reset() { if (auto* previous = std::exchange(ptr_, nullptr)) previous->Release(); }
    T** put() { reset(); return &ptr_; }
private:
    T* ptr_ = nullptr;
};

class Handle {
public:
    explicit Handle(HANDLE value = nullptr) : value_(value) {}
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& other) noexcept : value_(std::exchange(other.value_, nullptr)) {}
    Handle& operator=(Handle&& other) noexcept {
        if (this != &other) {
            if (*this) CloseHandle(value_);
            value_ = std::exchange(other.value_, nullptr);
        }
        return *this;
    }
    ~Handle() { if (*this) CloseHandle(value_); }
    HANDLE get() const { return value_; }
    explicit operator bool() const { return value_ && value_ != INVALID_HANDLE_VALUE; }
private:
    HANDLE value_;
};

inline bool running(const fs::path& executable) {
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
    if (!snapshot) return false;
    const auto name = executable.filename().wstring();
    PROCESSENTRY32W item{};
    item.dwSize = sizeof(item);
    for (BOOL more = Process32FirstW(snapshot.get(), &item); more; more = Process32NextW(snapshot.get(), &item)) {
        if (_wcsicmp(item.szExeFile, name.c_str()) == 0) return true;
    }
    return false;
}

inline std::wstring environment(const wchar_t* key) {
    const DWORD n = GetEnvironmentVariableW(key, nullptr, 0);
    if (!n) return {};
    std::wstring out(n, L'\0');
    out.resize(GetEnvironmentVariableW(key, out.data(), n));
    return out;
}

inline std::wstring quote(const fs::path& argument) {
    return L"\"" + argument.wstring() + L"\"";
}

inline fs::path plugin_data(const fs::path& profile) {
    return profile / L"plugin-data" / L"dsh-hello-splash";
}

inline fs::path program_file() {
    std::wstring path(32768, L'\0');
    path.resize(GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size())));
    return path;
}

inline void message(const std::wstring& detail, UINT flags = MB_OK | MB_ICONERROR) {
    MessageBoxW(nullptr, detail.c_str(), L"DSH Next 启动动画", flags);
}

