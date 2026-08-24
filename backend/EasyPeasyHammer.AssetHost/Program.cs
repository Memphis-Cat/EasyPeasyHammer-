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
    readonly List<AssetItem> sounds = [];
    readonly List<AssetItem> particles = [];
    readonly Dictionary<string, AssetItem> unique = new(StringComparer.OrdinalIgnoreCase);
    readonly List<string> indexedMounts = [];
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
        soundCount = sounds.Count,
        particleCount = particles.Count,
        indexedVpkCount = indexPackages.Count,
        indexedMounts = indexedMounts.ToArray(),
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
            sounds.Clear();
            particles.Clear();
            unique.Clear();
            indexedMounts.Clear();

            var resolved = ResolveCs2Root(root) ?? throw new DirectoryNotFoundException("The selected folder is not a CS2 installation.");
            var gameInfo = Path.Combine(resolved, "game", "csgo", "gameinfo.gi");
            loader = new GameFileLoader(null, gameInfo);
            cs2Root = resolved;

            var gameRoot = Path.Combine(resolved, "game");
            IndexHammerMounts(gameRoot, gameInfo);
            return Status();
        }
        catch (Exception ex)
        {
            return new { ok = false, error = ex.Message };
        }
    }

    void IndexHammerMounts(string gameRoot, string gameInfo)
    {
        foreach (var mount in GameSearchMounts(gameRoot, gameInfo))
        {
            var mountName = Normalize(Path.GetRelativePath(gameRoot, mount));
            indexedMounts.Add(mountName);

            // Loose files override packaged files inside the same Source 2 mount.
            IndexLooseFiles(mount, $"{mountName}-loose");

            string[] packages;
            try
            {
                packages = Directory.EnumerateFiles(mount, "*_dir.vpk", SearchOption.TopDirectoryOnly)
                    .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                    .ToArray();
            }
            catch { continue; }

            foreach (var vpk in packages)
            {
                try
                {
                    var package = new Package();
                    package.Read(vpk);
                    indexPackages.Add(package);
                    IndexPackage(package, Normalize(Path.GetRelativePath(gameRoot, vpk)));
                }
                catch { }
            }
        }
    }

    static IEnumerable<string> GameSearchMounts(string gameRoot, string gameInfo)
    {
        var output = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Add(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return;
            var clean = value.Trim().Trim('"').Replace('\\', '/');
            if (clean.StartsWith("|gameinfo_path|", StringComparison.OrdinalIgnoreCase))
                clean = "csgo/" + clean.Substring("|gameinfo_path|".Length).TrimStart('/', '.');
            if (clean.Contains('|') || clean.Contains('*') || clean.Contains('!')) return;
            var candidate = Path.GetFullPath(Path.Combine(gameRoot, clean.Replace('/', Path.DirectorySeparatorChar)));
            if (!Directory.Exists(candidate) || !seen.Add(candidate)) return;
            output.Add(candidate);
        }

        try
        {
            var text = File.ReadAllText(gameInfo);
            var block = ExtractNamedBraceBlock(text, "SearchPaths");
            foreach (var raw in block.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
            {
                var line = StripLineComment(raw).Trim();
                var match = Regex.Match(line, "^(?:Game(?:_LowViolence)?|Mod)\\s+(?:\\\"([^\\\"]+)\\\"|([^\\s{}]+))", RegexOptions.IgnoreCase);
                if (match.Success) Add(match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value);
            }
        }
        catch { }

        // These are the stock CS2/Hammer mounts. They are only appended when
        // they actually exist, and never outrank SearchPaths entries above.
        foreach (var fallback in new[] { "csgo", "csgo_imported", "csgo_core", "core", "sdktools" }) Add(fallback);
        return output;
    }

    static string ExtractNamedBraceBlock(string text, string name)
    {
        var match = Regex.Match(text, $"\\b{Regex.Escape(name)}\\b", RegexOptions.IgnoreCase);
        if (!match.Success) return "";
        var open = text.IndexOf('{', match.Index + match.Length);
        if (open < 0) return "";
        var depth = 0;
        var quoted = false;
        var escaped = false;
        for (var i = open; i < text.Length; i++)
        {
            var c = text[i];
            if (escaped) { escaped = false; continue; }
            if (quoted && c == '\\') { escaped = true; continue; }
            if (c == '"') { quoted = !quoted; continue; }
            if (quoted) continue;
            if (c == '{') depth++;
            else if (c == '}' && --depth == 0) return text[(open + 1)..i];
        }
        return text[(open + 1)..];
    }

    static string StripLineComment(string line)
    {
        var quoted = false;
        var escaped = false;
        for (var i = 0; i < line.Length - 1; i++)
        {
            var c = line[i];
            if (escaped) { escaped = false; continue; }
            if (quoted && c == '\\') { escaped = true; continue; }
            if (c == '"') { quoted = !quoted; continue; }
            if (!quoted && c == '/' && line[i + 1] == '/') return line[..i];
        }
        return line;
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
        foreach (var pattern in new[] { "*.vmat_c", "*.vmdl_c", "*.vsnd_c", "*.vpcf_c" })
        {
            try
            {
                foreach (var file in Directory.EnumerateFiles(root, pattern, SearchOption.AllDirectories))
                    AddCompiledAsset(Normalize(Path.GetRelativePath(root, file)), source);
            }
            catch { }
        }
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
        else if (compiledPath.EndsWith(".vsnd_c", StringComparison.OrdinalIgnoreCase))
        {
            kind = "sound";
            sourcePath = compiledPath[..^2];
        }
        else if (compiledPath.EndsWith(".vpcf_c", StringComparison.OrdinalIgnoreCase))
        {
            kind = "particle";
            sourcePath = compiledPath[..^2];
        }
        else return;

        var uniqueKey = $"{kind}:{sourcePath}";
        if (unique.ContainsKey(uniqueKey)) return;
        var name = Path.GetFileNameWithoutExtension(sourcePath).Replace('_', ' ');
        var item = new AssetItem(name, sourcePath, kind, source);
        unique[uniqueKey] = item;
        switch (kind)
        {
            case "material": materials.Add(item); break;
            case "model": models.Add(item); break;
            case "sound": sounds.Add(item); break;
            case "particle": particles.Add(item); break;
        }
    }

    public object Search(string kind, string? query, int limit)
    {
        if (loader is null) return new { ok = false, error = "CS2 assets are not loaded.", items = Array.Empty<AssetItem>() };
        var q = (query ?? "").Trim();
        var normalizedKind = (kind ?? "material").Trim().ToLowerInvariant();
        var source = normalizedKind switch
        {
            "model" or "models" or "prop" or "props" => models,
            "sound" or "sounds" => sounds,
            "particle" or "particles" or "vfx" => particles,
            _ => materials
        };

        IEnumerable<AssetItem> result = source;
        if (q.Length > 0)
        {
            var words = q.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            result = result.Where(item => words.All(word =>
                item.path.Contains(word, StringComparison.OrdinalIgnoreCase)
                || item.name.Contains(word, StringComparison.OrdinalIgnoreCase)));
        }

        var max = Math.Clamp(limit, 1, 5000);
        var items = result
            .OrderBy(item => SearchScore(item, q))
            .ThenBy(item => item.path.Length)
            .ThenBy(item => item.path, StringComparer.OrdinalIgnoreCase)
            .Take(max)
            .ToArray();
        return new { ok = true, items, total = source.Count, returned = items.Length, kind = normalizedKind };
    }

    static int SearchScore(AssetItem item, string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return 10;
        var q = query.Trim();
        var stem = Path.GetFileNameWithoutExtension(item.path);
        if (stem.Equals(q, StringComparison.OrdinalIgnoreCase) || item.name.Equals(q, StringComparison.OrdinalIgnoreCase)) return 0;
        if (stem.StartsWith(q, StringComparison.OrdinalIgnoreCase) || item.name.StartsWith(q, StringComparison.OrdinalIgnoreCase)) return 1;
        if (stem.Contains(q, StringComparison.OrdinalIgnoreCase) || item.name.Contains(q, StringComparison.OrdinalIgnoreCase)) return 2;
        return 3;
    }

    public object MaterialPreview(string materialPath)
    {
        if (loader is null) return new { ok = false, error = "CS2 assets are not loaded." };
        var requested = NormalizeSourcePath(materialPath, ".vmat");
        var materialFound = false;
        string? lastError = null;

        foreach (var normalized in ResourceCandidates(requested, ".vmat", "materials"))
        {
            try
            {
                using var materialResource = loader.LoadFileCompiled(normalized);
                if (materialResource?.DataBlock is not Material material) continue;
                materialFound = true;

                var textureChoices = new List<string>();
                foreach (var preferred in new[] { "g_tColor", "g_tColor1", "g_tBaseColor", "g_tDiffuse", "g_tAlbedo", "TextureColor", "TextureBase" })
                    if (material.TextureParams.TryGetValue(preferred, out var value) && !string.IsNullOrWhiteSpace(value)) textureChoices.Add(value);
                foreach (var pair in material.TextureParams)
                {
                    if (string.IsNullOrWhiteSpace(pair.Value)) continue;
                    if (Regex.IsMatch(pair.Key, "color|albedo|diffuse|base", RegexOptions.IgnoreCase) && !textureChoices.Any(x => x.Equals(pair.Value, StringComparison.OrdinalIgnoreCase)))
                        textureChoices.Add(pair.Value);
                }
                foreach (var value in material.TextureParams.Values)
                    if (!string.IsNullOrWhiteSpace(value) && !textureChoices.Any(x => x.Equals(value, StringComparison.OrdinalIgnoreCase))) textureChoices.Add(value);

                foreach (var texturePath in textureChoices)
                {
                    foreach (var sourceTexture in ResourceCandidates(texturePath, ".vtex", "materials"))
                    {
                        try
                        {
                            using var textureResource = loader.LoadFileCompiled(sourceTexture);
                            if (textureResource?.DataBlock is not Texture texture) continue;

                            var cacheKey = Hash($"{normalized}|{sourceTexture}");
                            var outPath = Path.Combine(cacheRoot, "materials", cacheKey + ".png");
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
                                requested,
                                resource = normalized,
                                texture = sourceTexture,
                                shader = material.ShaderName,
                                width,
                                height
                            };
                        }
                        catch (Exception ex) { lastError = ex.Message; }
                    }
                }
                lastError = "Material exists, but none of its texture resources could be decoded for the editor preview.";
            }
            catch (Exception ex) { lastError = ex.Message; }
        }

        return new
        {
            ok = false,
            found = materialFound,
            requested,
            error = materialFound ? lastError ?? "Material has no previewable color texture." : lastError ?? "Material could not be decoded from the mounted CS2 search paths."
        };
    }

    public object ModelPreview(string modelPath)
    {
        if (loader is null) return new { ok = false, error = "CS2 assets are not loaded." };
        foreach (var normalized in ResourceCandidates(modelPath, ".vmdl", null))
        {
            try
            {
                var key = Hash(normalized);
                var outPath = Path.Combine(cacheRoot, "models", key + ".glb");
                if (File.Exists(outPath)) return new { ok = true, path = outPath, resource = normalized, scale = 39.37007874015748 };

                using var resource = loader.LoadFileCompiled(normalized);
                if (resource is null || !GltfModelExporter.CanExport(resource)) continue;
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
            catch { }
        }
        return new { ok = false, error = "Model could not be decoded from the mounted CS2 search paths." };
    }

    static IEnumerable<string> ResourceCandidates(string value, string extension, string? conventionalPrefix)
    {
        var normalized = NormalizeSourcePath(value, extension);
        var output = new List<string>();
        void Add(string candidate)
        {
            candidate = NormalizeSourcePath(candidate, extension);
            if (!output.Any(x => x.Equals(candidate, StringComparison.OrdinalIgnoreCase))) output.Add(candidate);
        }

        if (!string.IsNullOrWhiteSpace(conventionalPrefix))
        {
            var prefix = conventionalPrefix.Trim('/', '\\') + "/";
            if (normalized.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                Add(normalized);
                Add(normalized[prefix.Length..]);
            }
            else
            {
                Add(prefix + normalized);
                Add(normalized);
            }
        }
        else Add(normalized);
        return output;
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
                foreach (Match match in Regex.Matches(text, "\\\"path\\\"\\s*\\\"([^\\\"]+)\\\"", RegexOptions.IgnoreCase))
                {
                    var library = match.Groups[1].Value.Replace("\\\\", "\\");
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
                    "ping" => new { ok = true, version = "1.2" },
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
