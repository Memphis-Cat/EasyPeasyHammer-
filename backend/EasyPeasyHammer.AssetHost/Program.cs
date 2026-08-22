// byanca
using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using SteamDatabase.ValvePak;
using ValveResourceFormat;
using ValveResourceFormat.IO;
using ValveResourceFormat.ResourceTypes;

record AssetItem(string name, string path, string kind, string source);
record HostRequest(string? id, string? command, JsonElement args);

sealed class AssetService : IDisposable
{
    readonly string cacheRoot;
    readonly List<Package> indexPackages = [];
    readonly List<AssetItem> materials = [];
    readonly List<AssetItem> models = [];
    readonly Dictionary<string, AssetItem> unique = new(StringComparer.OrdinalIgnoreCase);
    GameFileLoader? loader;
    string? cs2Root;

    public AssetService(string cacheRoot)
    {
        this.cacheRoot = cacheRoot;
        Directory.CreateDirectory(cacheRoot);
    }

    public object Status() => new
    {
        ok = true,
        available = loader is not null,
        cs2Root,
        materialCount = materials.Count,
        modelCount = models.Count,
        cacheRoot
    };

    public object Detect(string? preferred = null)
    {
        var found = ResolveCs2Root(preferred) ?? DiscoverCs2Root();
        if (found is null) return new { ok = false, error = "Counter-Strike 2 was not found. Choose the CS2 folder manually." };
        return Load(found);
    }

    public object Load(string root)
    {
        try
        {
            DisposePackages();
            loader?.Dispose();
            loader = null;
            materials.Clear();
            models.Clear();
            unique.Clear();

            var resolved = ResolveCs2Root(root) ?? throw new DirectoryNotFoundException("The selected folder is not a CS2 installation.");
            var gameInfo = Path.Combine(resolved, "game", "csgo", "gameinfo.gi");
            loader = new GameFileLoader(null, gameInfo);
            cs2Root = resolved;

            var roots = new[] { "csgo", "csgo_imported", "csgo_core", "core" };
            foreach (var mod in roots)
            {
                var vpk = Path.Combine(resolved, "game", mod, "pak01_dir.vpk");
                if (!File.Exists(vpk)) continue;
                try
                {
                    var package = new Package();
                    package.Read(vpk);
                    indexPackages.Add(package);
                    IndexPackage(package, mod);
                }
                catch { }
            }

            IndexLooseFiles(Path.Combine(resolved, "game", "csgo"), "csgo-loose");
            return Status();
        }
        catch (Exception ex)
        {
            return new { ok = false, error = ex.Message };
        }
    }

    void IndexPackage(Package package, string source)
    {
        if (package.Entries is null) return;
        foreach (var list in package.Entries.Values)
        foreach (var entry in list)
        {
            var compiled = Normalize(entry.GetFullPath());
            AddCompiledAsset(compiled, source);
        }
    }

    void IndexLooseFiles(string root, string source)
    {
        if (!Directory.Exists(root)) return;
        try
        {
            foreach (var file in Directory.EnumerateFiles(root, "*.vmat_c", SearchOption.AllDirectories).Take(30000))
                AddCompiledAsset(Normalize(Path.GetRelativePath(root, file)), source);
            foreach (var file in Directory.EnumerateFiles(root, "*.vmdl_c", SearchOption.AllDirectories).Take(30000))
                AddCompiledAsset(Normalize(Path.GetRelativePath(root, file)), source);
        }
        catch { }
    }

    void AddCompiledAsset(string compiledPath, string source)
    {
        string kind;
        string sourcePath;
        if (compiledPath.EndsWith(".vmat_c", StringComparison.OrdinalIgnoreCase))
        {
            kind = "material";
            sourcePath = compiledPath[..^2];
        }
        else if (compiledPath.EndsWith(".vmdl_c", StringComparison.OrdinalIgnoreCase))
        {
            kind = "model";
            sourcePath = compiledPath[..^2];
        }
        else return;

        if (unique.ContainsKey(sourcePath)) return;
        var name = Path.GetFileNameWithoutExtension(sourcePath).Replace('_', ' ');
        var item = new AssetItem(name, sourcePath, kind, source);
        unique[sourcePath] = item;
        if (kind == "material") materials.Add(item); else models.Add(item);
    }

    public object Search(string kind, string? query, int limit)
    {
        if (loader is null) return new { ok = false, error = "CS2 assets are not loaded.", items = Array.Empty<AssetItem>() };
        var q = (query ?? "").Trim();
        var source = kind.Equals("model", StringComparison.OrdinalIgnoreCase) || kind.Equals("models", StringComparison.OrdinalIgnoreCase) ? models : materials;
        IEnumerable<AssetItem> result = source;
        if (q.Length > 0)
        {
            var words = q.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            result = result.Where(x => words.All(w => x.path.Contains(w, StringComparison.OrdinalIgnoreCase) || x.name.Contains(w, StringComparison.OrdinalIgnoreCase)));
        }
        var items = result.OrderBy(x => x.path.Length).ThenBy(x => x.path, StringComparer.OrdinalIgnoreCase).Take(Math.Clamp(limit, 1, 800)).ToArray();
        return new { ok = true, items, total = source.Count };
    }

    public object MaterialPreview(string materialPath)
    {
        if (loader is null) return new { ok = false, error = "CS2 assets are not loaded." };
        try
        {
            var normalized = NormalizeSourcePath(materialPath, ".vmat");
            var key = Hash(normalized);
            var outPath = Path.Combine(cacheRoot, "materials", key + ".png");

            using var materialResource = loader.LoadFileCompiled(normalized);
            if (materialResource?.DataBlock is not Material material) return new { ok = false, error = "Material could not be decoded." };

            string? texturePath = null;
            foreach (var preferred in new[] { "g_tColor", "g_tColor1", "g_tBaseColor", "g_tDiffuse", "g_tAlbedo" })
                if (material.TextureParams.TryGetValue(preferred, out texturePath) && !string.IsNullOrWhiteSpace(texturePath)) break;
            texturePath ??= material.TextureParams.Values.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x));
            if (string.IsNullOrWhiteSpace(texturePath)) return new { ok = false, error = "Material has no previewable texture." };

            var sourceTexture = NormalizeSourcePath(texturePath, ".vtex");
            using var textureResource = loader.LoadFileCompiled(sourceTexture);
            if (textureResource?.DataBlock is not Texture texture) return new { ok = false, error = "Material texture could not be decoded." };

            var width = Math.Max(1, (int)texture.ActualWidth);
            var height = Math.Max(1, (int)texture.ActualHeight);
            if (!File.Exists(outPath))
            {
                using var bitmap = texture.GenerateBitmap();
                var png = TextureExtract.ToPngImage(bitmap);
                Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
                File.WriteAllBytes(outPath, png);
            }

            return new
            {
                ok = true,
                path = outPath,
                resource = normalized,
                texture = sourceTexture,
                shader = material.ShaderName,
                width,
                height
            };
        }
        catch (Exception ex)
        {
            return new { ok = false, error = ex.Message };
        }
    }

    public object ModelPreview(string modelPath)
    {
        if (loader is null) return new { ok = false, error = "CS2 assets are not loaded." };
        try
        {
            var normalized = NormalizeSourcePath(modelPath, ".vmdl");
            var key = Hash(normalized);
            var outPath = Path.Combine(cacheRoot, "models", key + ".glb");
            if (File.Exists(outPath)) return new { ok = true, path = outPath, resource = normalized, scale = 39.37007874015748 };

            using var resource = loader.LoadFileCompiled(normalized);
            if (resource is null || !GltfModelExporter.CanExport(resource)) return new { ok = false, error = "Model could not be decoded." };
            Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
            var exporter = new GltfModelExporter(loader)
            {
                ExportMaterials = true,
                AdaptTextures = true,
                ExportAnimations = false,
                SatelliteImages = false,
                ProgressReporter = new Progress<string>(_ => { })
            };
            exporter.Export(resource, outPath);
            return new { ok = true, path = outPath, resource = normalized, scale = 39.37007874015748 };
        }
        catch (Exception ex)
        {
            return new { ok = false, error = ex.Message };
        }
    }

    public object HammerInfo()
    {
        if (cs2Root is null) return new { ok = false, error = "CS2 is not configured." };
        var bin = Path.Combine(cs2Root, "game", "bin", "win64");
        var csgocfg = Path.Combine(bin, "csgocfg.exe");
        var rc = Path.Combine(bin, "resourcecompiler.exe");
        return new { ok = File.Exists(csgocfg), csgocfg, resourceCompiler = rc, cs2Root };
    }

    static string Normalize(string value) => value.Replace('\\', '/').TrimStart('/');

    static string NormalizeSourcePath(string value, string extension)
    {
        var p = Normalize(value);
        if (p.EndsWith("_c", StringComparison.OrdinalIgnoreCase)) p = p[..^2];
        if (!p.EndsWith(extension, StringComparison.OrdinalIgnoreCase)) p += extension;
        return p;
    }

    static string Hash(string value)
    {
        var bytes = System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(value.ToLowerInvariant()));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    static string? ResolveCs2Root(string? candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate)) return null;
        var p = Path.GetFullPath(Environment.ExpandEnvironmentVariables(candidate.Trim(' ', '"')));
        var candidates = new List<string> { p };
        if (Path.GetFileName(p).Equals("csgo", StringComparison.OrdinalIgnoreCase))
        {
            var game = Directory.GetParent(p)?.FullName;
            var root = game is null ? null : Directory.GetParent(game)?.FullName;
            if (root is not null) candidates.Add(root);
        }
        if (Path.GetFileName(p).Equals("game", StringComparison.OrdinalIgnoreCase))
        {
            var root = Directory.GetParent(p)?.FullName;
            if (root is not null) candidates.Add(root);
        }
        foreach (var root in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
            if (File.Exists(Path.Combine(root, "game", "csgo", "gameinfo.gi"))) return root;
        return null;
    }

    static string? DiscoverCs2Root()
    {
        var guesses = new List<string>();
        var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        guesses.Add(Path.Combine(pf86, "Steam", "steamapps", "common", "Counter-Strike Global Offensive"));
        guesses.Add(Path.Combine(pf, "Steam", "steamapps", "common", "Counter-Strike Global Offensive"));

        foreach (var steamRoot in new[] { Path.Combine(pf86, "Steam"), Path.Combine(pf, "Steam") })
        {
            var vdf = Path.Combine(steamRoot, "steamapps", "libraryfolders.vdf");
            if (!File.Exists(vdf)) continue;
            try
            {
                var text = File.ReadAllText(vdf);
                foreach (Match m in Regex.Matches(text, "\\\"path\\\"\\s*\\\"([^\\\"]+)\\\"", RegexOptions.IgnoreCase))
                {
                    var library = m.Groups[1].Value.Replace("\\\\", "\\");
                    guesses.Add(Path.Combine(library, "steamapps", "common", "Counter-Strike Global Offensive"));
                }
            }
            catch { }
        }

        foreach (var guess in guesses.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var root = ResolveCs2Root(guess);
            if (root is not null) return root;
        }
        return null;
    }

    void DisposePackages()
    {
        foreach (var package in indexPackages) package.Dispose();
        indexPackages.Clear();
    }

    public void Dispose()
    {
        DisposePackages();
        loader?.Dispose();
    }
}

static class Program
{
    static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    static async Task Main(string[] args)
    {
        var cache = Arg(args, "--cache") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EasyPeasyHammer", "AssetCache");
        using var service = new AssetService(cache);
        service.Detect(Arg(args, "--cs2"));

        Console.OutputEncoding = System.Text.Encoding.UTF8;
        string? line;
        while ((line = await Console.In.ReadLineAsync()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            string? id = null;
            object result;
            try
            {
                var request = JsonSerializer.Deserialize<HostRequest>(line, JsonOptions) ?? throw new InvalidDataException("Invalid request.");
                id = request.id;
                var a = request.args;
                result = (request.command ?? "").ToLowerInvariant() switch
                {
                    "ping" => new { ok = true, version = "1.0" },
                    "status" => service.Status(),
                    "detect" => service.Detect(GetString(a, "path")),
                    "set-path" => service.Load(GetString(a, "path") ?? ""),
                    "search" => service.Search(GetString(a, "kind") ?? "material", GetString(a, "query"), GetInt(a, "limit", 200)),
                    "material-preview" => service.MaterialPreview(GetString(a, "path") ?? ""),
                    "model-preview" => service.ModelPreview(GetString(a, "path") ?? ""),
                    "hammer-info" => service.HammerInfo(),
                    _ => new { ok = false, error = "Unknown command." }
                };
            }
            catch (Exception ex)
            {
                result = new { ok = false, error = ex.Message };
            }
            Console.WriteLine(JsonSerializer.Serialize(new { id, result }, JsonOptions));
            Console.Out.Flush();
        }
    }

    static string? Arg(string[] args, string key)
    {
        var i = Array.FindIndex(args, x => x.Equals(key, StringComparison.OrdinalIgnoreCase));
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    static string? GetString(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    static int GetInt(JsonElement e, string name, int fallback) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.TryGetInt32(out var n) ? n : fallback;
}
