#include "vector-scene.h"

#include <dwrite_1.h>

#include <algorithm>
#include <cmath>
#include <numbers>

namespace {
float clamp_unit(float x) { return std::clamp(x, 0.0f, 1.0f); }
float normal(float x, float from, float to) { return clamp_unit((x - from) / (to - from)); }
float smooth(float x) { return x * x * (3 - 2 * x); }

void include(D2D1_RECT_F& bounds, D2D1_POINT_2F point, float inset = 0) {
    bounds.left = std::min(bounds.left, point.x - inset);
    bounds.top = std::min(bounds.top, point.y - inset);
    bounds.right = std::max(bounds.right, point.x + inset);
    bounds.bottom = std::max(bounds.bottom, point.y + inset);
}

void include_rect(D2D1_RECT_F& outer, const D2D1_RECT_F& inner, float inset = 0) {
    include(outer, {inner.left, inner.top}, inset);
    include(outer, {inner.right, inner.bottom}, inset);
}

constexpr D2D1_STROKE_STYLE_PROPERTIES rounded_properties() {
    return { D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND,
             D2D1_LINE_JOIN_ROUND, 10, D2D1_DASH_STYLE_SOLID, 0 };
}
} // namespace

VectorScene::~VectorScene() {
    target_.reset();
    if (bitmap_) {
        SelectObject(surface_, previous_);
        DeleteObject(bitmap_);
    }
    if (surface_) DeleteDC(surface_);
}

bool VectorScene::make_curve(std::span<const D2D1_POINT_2F> points, Com<ID2D1PathGeometry>& path) const {
    if (points.size() < 3 || FAILED(factory_->CreatePathGeometry(path.put()))) return false;
    Com<ID2D1GeometrySink> sink;
    if (FAILED(path->Open(sink.put()))) return false;

    sink->BeginFigure(points.front(), D2D1_FIGURE_BEGIN_HOLLOW);
    D2D1_POINT_2F last_midpoint{};
    for (size_t i = 1; i + 1 < points.size(); ++i) {
        last_midpoint = { (points[i].x + points[i + 1].x) * 0.5f, (points[i].y + points[i + 1].y) * 0.5f };
        sink->AddQuadraticBezier(D2D1::QuadraticBezierSegment(points[i], last_midpoint));
    }
    const auto control = points[points.size() - 2];
    const auto reflected = D2D1::Point2F(2 * last_midpoint.x - control.x, 2 * last_midpoint.y - control.y);
    sink->AddQuadraticBezier(D2D1::QuadraticBezierSegment(reflected, points.back()));
    sink->EndFigure(D2D1_FIGURE_END_OPEN);
    return SUCCEEDED(sink->Close());
}

bool VectorScene::make_logo() {
    if (FAILED(factory_->CreatePathGeometry(logo_.put()))) return false;
    Com<ID2D1GeometrySink> sink;
    if (FAILED(logo_->Open(sink.put()))) return false;
    sink->SetFillMode(D2D1_FILL_MODE_WINDING);
    const auto on_canvas = [this](D2D1_POINT_2F p) {
        return D2D1::Point2F(artwork::kLogoLeft + p.x * artwork::kLogoScale,
                            artwork::kLogoTop + logo_offset_ + p.y * artwork::kLogoScale);
    };
    for (const auto& segment : artwork::kLogo) {
        switch (segment.kind) {
        case 'M': sink->BeginFigure(on_canvas(segment.a), D2D1_FIGURE_BEGIN_FILLED); break;
        case 'L': sink->AddLine(on_canvas(segment.a)); break;
        case 'C': sink->AddBezier(D2D1::BezierSegment(on_canvas(segment.a), on_canvas(segment.b), on_canvas(segment.c))); break;
        case 'Z': sink->EndFigure(D2D1_FIGURE_END_CLOSED); break;
        }
    }
    return SUCCEEDED(sink->Close());
}

void VectorScene::set_content_bounds() {
    logo_->GetBounds(nullptr, &logo_bounds_);
    if (subtitle_.get()) {
        DWRITE_TEXT_METRICS metrics{};
        if (SUCCEEDED(subtitle_->GetMetrics(&metrics))) {
            const float top = artwork::kSubtitleY - 22 + metrics.top;
            include_rect(logo_bounds_, {metrics.left, top, metrics.left + metrics.width, top + metrics.height});
        }
    }

    const float limit = 10000;
    writing_bounds_ = {limit, limit, -limit, -limit};
    for (size_t i = 0; i < pen_.size(); ++i) {
        D2D1_RECT_F shape{};
        if (SUCCEEDED(pen_[i].path->GetWidenedBounds(
                artwork::kStrokes[i].width, rounded_.get(), nullptr, 0.1f, &shape))) {
            include_rect(writing_bounds_, shape, 2);
        }
    }
    morph_bounds_ = writing_bounds_;
    include_rect(morph_bounds_, logo_bounds_);
    if (!morph_) return;
    for (const auto& ribbon : artwork::kRibbons) {
        for (size_t i = 0; i < artwork::kPathPoints; ++i) {
            const float margin = std::abs(ribbon.bend) + 7 * std::abs(ribbon.twist) + 8;
            include(morph_bounds_, ribbon.from[i], margin);
            include(morph_bounds_, {ribbon.to[i].x, ribbon.to[i].y + logo_offset_}, margin);
        }
    }
}

bool VectorScene::initialize(bool morph, bool subtitle) {
    morph_ = morph;
    logo_offset_ = subtitle ? 0.0f : 19.0f;
    if (FAILED(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, factory_.put())) ||
        FAILED(factory_->CreateStrokeStyle(rounded_properties(), nullptr, 0, rounded_.put())) ||
        !make_logo() || !create_target()) return false;

    for (size_t i = 0; i < pen_.size(); ++i) {
        auto& pen = pen_[i];
        if (!make_curve(artwork::kStrokes[i].points, pen.path) ||
            FAILED(pen.path->ComputeLength(nullptr, 0.025f, &pen.length))) return false;
    }

    if (subtitle) {
        Com<IDWriteFactory> text_factory;
        Com<IDWriteTextFormat> format;
        constexpr wchar_t caption[] = L"DeepSeek Harness Next";
        constexpr auto length = static_cast<UINT32>(std::size(caption) - 1);
        if (SUCCEEDED(DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
                                         reinterpret_cast<IUnknown**>(text_factory.put()))) &&
            SUCCEEDED(text_factory->CreateTextFormat(L"Segoe UI", nullptr, DWRITE_FONT_WEIGHT_MEDIUM,
                DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, 20, L"en-us", format.put()))) {
            format->SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER);
            if (SUCCEEDED(text_factory->CreateTextLayout(caption, length, format.get(),
                    artwork::kWidth, 42, subtitle_.put()))) {
                Com<IDWriteTextLayout1> spacing;
                if (SUCCEEDED(subtitle_->QueryInterface(__uuidof(IDWriteTextLayout1),
                        reinterpret_cast<void**>(spacing.put())))) spacing->SetCharacterSpacing(0, 3.2f, 0, {0, length - 1});
            }
        }
    }
    set_content_bounds();
    return true;
}

bool VectorScene::create_target() {
    gradient_.reset();
    logo_mask_.reset();
    subtitle_brush_.reset();

    const auto properties = D2D1::RenderTargetProperties(
        D2D1_RENDER_TARGET_TYPE_DEFAULT,
        D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_IGNORE),
        96, 96);
    if (FAILED(factory_->CreateDCRenderTarget(&properties, target_.put()))) return false;

    std::array<D2D1_GRADIENT_STOP, std::size(artwork::kColors)> stops{};
    for (size_t i = 0; i < stops.size(); ++i) {
        stops[i] = {float(i) / float(stops.size() - 1), D2D1::ColorF(artwork::kColors[i])};
    }
    Com<ID2D1GradientStopCollection> collection;
    const bool ready = SUCCEEDED(target_->CreateGradientStopCollection(
            stops.data(), static_cast<UINT32>(stops.size()), D2D1_GAMMA_2_2, D2D1_EXTEND_MODE_CLAMP, collection.put())) &&
        SUCCEEDED(target_->CreateLinearGradientBrush(
            D2D1::LinearGradientBrushProperties({artwork::kLeft, 0}, {artwork::kRight, 0}),
            collection.get(), gradient_.put())) &&
        SUCCEEDED(target_->CreateSolidColorBrush(D2D1::ColorF(0x4a4a4f), subtitle_brush_.put())) &&
        SUCCEEDED(target_->CreateLayer(nullptr, logo_mask_.put()));
    if (!ready) target_.reset();
    else target_->SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
    return ready;
}

bool VectorScene::resize(HDC destination, int width, int height) {
    if (!surface_) surface_ = CreateCompatibleDC(destination);
    if (!surface_) return false;
    if (bitmap_ && width == width_ && height == height_) return true;

    BITMAPINFO info{};
    info.bmiHeader.biSize = sizeof(info.bmiHeader);
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* pixels = nullptr;
    const auto buffer = CreateDIBSection(surface_, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
    if (!buffer) return false;
    const auto previous = SelectObject(surface_, buffer);
    if (!previous || previous == HGDI_ERROR) {
        DeleteObject(buffer);
        return false;
    }
    if (bitmap_) DeleteObject(bitmap_);
    else previous_ = previous;
    bitmap_ = buffer;
    width_ = width;
    height_ = height;
    return true;
}

void VectorScene::color_extent(float progress) {
    const float x0 = std::lerp(artwork::kLeft, artwork::kLogoLeft, progress);
    const float x1 = std::lerp(artwork::kRight, artwork::kLogoRight, progress);
    gradient_->SetStartPoint(D2D1::Point2F(x0, 0));
    gradient_->SetEndPoint(D2D1::Point2F(x1, 0));
}

void VectorScene::draw_writing(float time, float opacity) {
    gradient_->SetOpacity(opacity);
    for (size_t i = 0; i < pen_.size(); ++i) {
        const auto& pen = pen_[i];
        const auto& stroke = artwork::kStrokes[i];
        if (time <= stroke.start) break;
        if (time >= stroke.end) {
            target_->DrawGeometry(pen.path.get(), gradient_.get(), stroke.width, rounded_.get());
            continue;
        }

        const float progress = normal(time, stroke.start, stroke.end);
        const float eased = progress - std::sin(progress * 2 * std::numbers::pi_v<float>) * 0.025f;
        const float span = pen.length / stroke.width;
        const float dashes[] = {span * eased, span + 1};
        auto properties = rounded_properties();
        properties.dashStyle = D2D1_DASH_STYLE_CUSTOM;
        Com<ID2D1StrokeStyle> writing;
        if (SUCCEEDED(factory_->CreateStrokeStyle(properties, dashes, 2, writing.put()))) {
            target_->DrawGeometry(pen.path.get(), gradient_.get(), stroke.width, writing.get());
        }
        break;
    }
}

void VectorScene::draw_morph(float progress) {
    const float spread = smooth(normal(progress, 0.65f, 0.995f));
    const float outline = 1 - smooth(normal(progress, 0.91f, 1.0f));
    std::array<Com<ID2D1PathGeometry>, std::size(artwork::kRibbons)> ribbons;
    for (size_t i = 0; i < ribbons.size(); ++i) {
        const auto& segment = artwork::kRibbons[i];
        const float mix = smooth(normal(progress, segment.delay, 0.96f));
        const float lift = std::sin(std::numbers::pi_v<float> * mix);
        std::array<D2D1_POINT_2F, artwork::kPathPoints> points;
        for (size_t j = 0; j < points.size(); ++j) {
            const auto a = segment.from[j];
            const auto b = segment.to[j];
            const float along = float(j) / float(points.size() - 1);
            const float wave = std::sin(along * 2 * std::numbers::pi_v<float>) * 7 * segment.twist;
            points[j] = {std::lerp(a.x, b.x, mix) + wave * lift,
                         std::lerp(a.y, b.y + logo_offset_, mix) + (segment.bend + wave) * lift};
        }
        if (!make_curve(points, ribbons[i])) continue;
        gradient_->SetOpacity(outline);
        target_->DrawGeometry(ribbons[i].get(), gradient_.get(), std::lerp(segment.width, 3.5f, mix), rounded_.get());
    }

    if (spread > 0) {
        target_->PushLayer(D2D1::LayerParameters(D2D1::InfiniteRect(), logo_.get()), logo_mask_.get());
        gradient_->SetOpacity(1);
        for (const auto& ribbon : ribbons) {
            if (ribbon.get()) target_->DrawGeometry(ribbon.get(), gradient_.get(), spread * 190, rounded_.get());
        }
        target_->PopLayer();
    }
}

void VectorScene::draw_logo(float opacity) {
    gradient_->SetOpacity(opacity);
    target_->FillGeometry(logo_.get(), gradient_.get());
}

void VectorScene::draw_subtitle(float opacity) {
    if (!subtitle_.get()) return;
    subtitle_brush_->SetOpacity(opacity);
    target_->DrawTextLayout({0, artwork::kSubtitleY - 22}, subtitle_.get(), subtitle_brush_.get());
}

bool VectorScene::paint(HDC destination, RECT bounds, COLORREF background, float time) {
    if (!target_.get() && !create_target()) return false;
    const int width = bounds.right - bounds.left;
    const int height = bounds.bottom - bounds.top;
    if (width <= 0 || height <= 0) return false;

    const float scale = std::min(width / artwork::kWidth, height / artwork::kHeight);
    const float dx = (width - scale * artwork::kWidth) * 0.5f;
    const float dy = (height - scale * artwork::kHeight) * 0.5f;
    const auto& content = time < artwork::kMorphStart ? writing_bounds_
        : time < artwork::kMorphEnd ? morph_bounds_ : logo_bounds_;
    RECT current{
        std::clamp(long(std::floor(dx + content.left * scale)) - 3, 0L, long(width)),
        std::clamp(long(std::floor(dy + content.top * scale)) - 3, 0L, long(height)),
        std::clamp(long(std::ceil(dx + content.right * scale)) + 3, 0L, long(width)),
        std::clamp(long(std::ceil(dy + content.bottom * scale)) + 3, 0L, long(height)),
    };
    const bool new_canvas = width != canvas_width_ || height != canvas_height_;
    RECT damage = current;
    if (!new_canvas) UnionRect(&damage, &current, &displayed_);
    const RECT surface_bounds{0, 0, damage.right - damage.left, damage.bottom - damage.top};
    if (surface_bounds.right <= 0 || surface_bounds.bottom <= 0 ||
        !resize(destination, surface_bounds.right, surface_bounds.bottom) ||
        FAILED(target_->BindDC(surface_, &surface_bounds))) return false;

    target_->BeginDraw();
    target_->SetTransform(D2D1::Matrix3x2F(scale, 0, 0, scale, dx - damage.left, dy - damage.top));
    target_->Clear(D2D1::ColorF(GetRValue(background) / 255.0f, GetGValue(background) / 255.0f,
                               GetBValue(background) / 255.0f));
    if (time < artwork::kMorphStart) {
        color_extent(0);
        draw_writing(time);
    } else if (time < artwork::kMorphEnd) {
        const float progress = normal(time, artwork::kMorphStart, artwork::kMorphEnd);
        const float fraction = smooth(progress);
        color_extent(fraction);
        if (morph_) {
            draw_morph(progress);
        } else {
            draw_writing(artwork::kWriteEnd, 1 - fraction);
            draw_logo(fraction);
        }
    } else {
        color_extent(1);
        draw_logo();
        draw_subtitle(smooth(normal(time, artwork::kMorphEnd, artwork::kMorphEnd + 150)));
    }

    const HRESULT status = target_->EndDraw();
    if (status == D2DERR_RECREATE_TARGET) target_.reset();
    if (FAILED(status)) return false;
    // The background remains in the layered window. Replace the old and new
    // artwork together so the compositor never sees a clear-only frame.
    if (new_canvas) {
        const auto brush = CreateSolidBrush(background);
        if (!brush) return false;
        FillRect(destination, &bounds, brush);
        DeleteObject(brush);
    }
    if (!BitBlt(destination, bounds.left + damage.left, bounds.top + damage.top,
                surface_bounds.right, surface_bounds.bottom, surface_, 0, 0, SRCCOPY)) return false;
    displayed_ = current;
    canvas_width_ = width;
    canvas_height_ = height;
    return true;
}


