#pragma once

#include "support.h"

#include <d2d1.h>
#include <dwrite.h>
#include "artwork.generated.h"

#include <array>
#include <span>

class VectorScene {
public:
    ~VectorScene();
    bool initialize(bool morph, bool subtitle);
    bool paint(HDC destination, RECT bounds, COLORREF background, float milliseconds);

private:
    bool create_target();
    bool resize(HDC destination, int width, int height);
    bool make_curve(std::span<const D2D1_POINT_2F> points, Com<ID2D1PathGeometry>& result) const;
    bool make_logo();
    void set_content_bounds();
    void color_extent(float morph);
    void draw_writing(float milliseconds, float opacity = 1);
    void draw_morph(float progress);
    void draw_logo(float opacity = 1);
    void draw_subtitle(float opacity);

    struct Pen {
        Com<ID2D1PathGeometry> path;
        float length = 0;
    };

    Com<ID2D1Factory> factory_;
    Com<ID2D1DCRenderTarget> target_;
    Com<ID2D1StrokeStyle> rounded_;
    Com<ID2D1LinearGradientBrush> gradient_;
    Com<ID2D1SolidColorBrush> subtitle_brush_;
    Com<ID2D1Layer> logo_mask_;
    Com<ID2D1PathGeometry> logo_;
    Com<IDWriteTextLayout> subtitle_;
    std::array<Pen, std::size(artwork::kStrokes)> pen_;
    HDC surface_ = nullptr;
    HBITMAP bitmap_ = nullptr;
    HGDIOBJ previous_ = nullptr;
    D2D1_RECT_F writing_bounds_{};
    D2D1_RECT_F morph_bounds_{};
    D2D1_RECT_F logo_bounds_{};
    RECT displayed_{};
    int canvas_width_ = 0;
    int canvas_height_ = 0;
    int width_ = 0;
    int height_ = 0;
    float logo_offset_ = 0;
    bool morph_ = true;
};

