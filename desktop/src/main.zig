const std = @import("std");
const runner = @import("runner");
const zero_native = @import("zero-native");

pub const panic = std.debug.FullPanic(zero_native.debug.capturePanic);

// Social Stockfish is a hosted web app (live backend: WebSocket, /simulate, /tts,
// Stripe, ...), so the native shell simply loads the deployed site in a WKWebView.
const app_url = "https://chat.lulzx.space/";

const App = struct {
    env_map: *std.process.Environ.Map,

    fn app(self: *@This()) zero_native.App {
        return .{
            .context = self,
            .name ="Social Stockfish",
            .source = zero_native.WebViewSource.url(app_url),
            .source_fn = source,
        };
    }

    fn source(context: *anyopaque) anyerror!zero_native.WebViewSource {
        _ = context;
        return zero_native.WebViewSource.url(app_url);
    }
};

const allowed_origins = [_][]const u8{
    "https://chat.lulzx.space",
    "https://checkout.stripe.com",
    "https://js.stripe.com",
};

pub fn main(init: std.process.Init) !void {
    var app = App{ .env_map = init.environ_map };
    try runner.runWithOptions(app.app(), .{
        .app_name ="Social Stockfish",
        .window_title ="Social Stockfish",
        .bundle_id ="space.lulzx.social-stockfish",
        .icon_path = "assets/icon.icns",
        .security = .{
            .navigation = .{ .allowed_origins = &allowed_origins },
        },
    }, init);
}

test "app url is configured" {
    try std.testing.expectEqualStrings("https://chat.lulzx.space/", app_url);
}
