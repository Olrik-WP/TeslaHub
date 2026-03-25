namespace TeslaHub.Api.Services;

public class CompositorService
{
    private static readonly Dictionary<string, string> PaintMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["SolidBlack"] = "PBSB", ["ObsidianBlack"] = "PBSB", ["Black"] = "PBSB",
        ["DeepBlue"] = "PPSB", ["DeepBlueMetallic"] = "PPSB",
        ["PearlWhite"] = "PPSW", ["Pearl White Multi-Coat"] = "PPSW", ["White"] = "PPSW",
        ["MidnightSilver"] = "PMNG", ["MidnightSilverMetallic"] = "PMNG",
        ["Red"] = "PPMR", ["RedMulticoat"] = "PPMR", ["RedMulti-Coat"] = "PPMR",
        ["Silver"] = "PMSS", ["SilverMetallic"] = "PMSS",
        ["UltraWhite"] = "PN01", ["ColdWhite"] = "PN01",
        ["UltraRed"] = "PR01",
        ["MidnightCherry"] = "PR00", ["MidnightCherryRed"] = "PR00",
        ["StealthGrey"] = "PMSG", ["StealthGray"] = "PMSG",
        ["QuickSilver"] = "PMSG",
        ["GlacierBlue"] = "PMAB",
        ["MarineBlue"] = "PPSB",
    };

    private static readonly Dictionary<string, string> WheelMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Pinwheel18"] = "W38B", ["Aero18"] = "W38B",
        ["Stiletto19"] = "W39B", ["Sport19"] = "W39B",
        ["Stiletto20"] = "W32B", ["Performance20"] = "W32B",
        ["Photon18"] = "W40B", ["Photon"] = "W40B",
        ["Nova19"] = "W41B", ["Nova"] = "W41B",
        ["Warp20"] = "W38A", ["Warp"] = "W38A",
        ["Gemini19"] = "WY19B", ["Gemini"] = "WY19B",
        ["Induction20"] = "WY20P", ["Induction"] = "WY20P",
        ["Uberturbine19"] = "W41B", ["Uberturbine"] = "W41B",
        ["Tempest19"] = "WS10", ["Tempest"] = "WS10",
        ["Arachnid21"] = "WS90", ["Arachnid"] = "WS90",
        ["Cyberstream20"] = "WX00", ["Cyberstream"] = "WX00",
        ["AeroTurbine19"] = "W39B", ["AeroTurbine20"] = "W32B",
        ["Apollo"] = "W40B",
    };

    private static readonly Dictionary<string, string> ModelMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["S"] = "ms", ["3"] = "m3", ["X"] = "mx", ["Y"] = "my",
        ["Model S"] = "ms", ["Model 3"] = "m3", ["Model X"] = "mx", ["Model Y"] = "my",
    };

    private static readonly Dictionary<string, string> DefaultWheel = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ms"] = "WS10", ["m3"] = "W38B", ["mx"] = "WX00", ["my"] = "WY19B",
    };

    public string? MapModel(string? model) =>
        model != null && ModelMap.TryGetValue(model, out var m) ? m : null;

    public string? MapPaint(string? exteriorColor) =>
        exteriorColor != null && PaintMap.TryGetValue(exteriorColor, out var p) ? p : null;

    public string? MapWheel(string? wheelType) =>
        wheelType != null && WheelMap.TryGetValue(wheelType, out var w) ? w : null;

    private static readonly HashSet<string> HighlandM3Wheels = new(StringComparer.OrdinalIgnoreCase)
    {
        "W38A", "W40B", "W41B"
    };

    public string BuildUrl(string modelCode, string paintCode, string wheelCode, string? variantCode = null)
    {
        var parts = new List<string>();

        if (modelCode == "m3")
        {
            if (HighlandM3Wheels.Contains(wheelCode))
            {
                parts.Add(variantCode ?? "MT337");
                parts.Add("IBB1");
            }
            else
            {
                parts.Add("IN3PB");
            }
        }

        parts.Add(paintCode);
        parts.Add(wheelCode);
        parts.Sort(StringComparer.Ordinal);

        var opts = string.Join(",", parts);
        return $"https://static-assets.tesla.com/configurator/compositor?model={modelCode}&view=STUD_3QTR&size=800&options={opts}&bkba_opt=2&file_type=jpg";
    }

    public string? TryBuildAutoUrl(string? model, string? exteriorColor, string? wheelType)
    {
        var modelCode = MapModel(model);
        var paintCode = MapPaint(exteriorColor);
        if (modelCode == null || paintCode == null) return null;

        var wheelCode = MapWheel(wheelType) ?? DefaultWheel.GetValueOrDefault(modelCode, "W38B");
        return BuildUrl(modelCode, paintCode, wheelCode);
    }
}
