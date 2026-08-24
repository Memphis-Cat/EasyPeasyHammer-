// byanca
using System.Collections;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using SteamDatabase.ValvePak;
using ValveResourceFormat;
using ValveResourceFormat.IO;
using ValveResourceFormat.ResourceTypes;

record DeepPackageCandidate(string path, string source, string scope);
record DeepCachedAsset(string name, string path, string kind, string source, string packagePath);
record DeepAssetIndexCache(
    int version,
    string cs2Root,
    string fingerprint,
    DeepCachedAsset[] assets,
    int indexedPackageCount,
    int failedPackageCount,
    int officialMapPackageCount,
    int addonPackageCount,
    int workshopPackageCount);

sealed class DeepPackageContext : IDisposable
{
    public readonly Package Package;
    public readonly GameFileLoader Loader;
    public long LastUse;

    public DeepPackageContext(string path)
    {
        Package = new Package();
        Package.OptimizeEntriesForBinarySearch(StringComparison.OrdinalIgnoreCase);
        Package.Read(path);
        Loader = new GameFileLoader(Package, path);
        LastUse = Environment.TickCount64;
    }

    public void Dispose()
    {
        try { Loader.Dispose(); } catch { }
        try { Package.Dispose(); } catch { }
    }
}

sealed class DeepAssetService : IDisposable
{
    const int DeepIndexVersion = 2;
    const int PreviewContextLimit = 6;
    static readonly JsonSerializerOptions CacheJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    readonly AssetService core;
    readonly string cacheRoot;
    readonly List<AssetItem> materials = [];
    readonly List<AssetItem> models = [];
    readonly List<AssetItem> sounds = [];
    readonly List<AssetItem> particles = [];
    readonly Dictionary<string, string> locations = new(StringComparer.OrdinalIgnoreCase);
    readonly HashSet<string> unique = new(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<string, DeepPackageContext> previewContexts = new(StringComparer.OrdinalIgnoreCase);

    string? cs2Root;
    string deepFingerprint = "";
    bool deepIndexCacheHit;
    int indexedPackageCount;
    int failedPackageCount;
    int officialMapPackageCount;
    int addonPackageCount;
    int workshopPackageCount;
    long deepScanMilliseconds;

    public DeepAssetService(string cacheRoot)
    {
        this.cacheRoot = cacheRoot;
        Directory.CreateDirectory(cacheRoot);
        core = new AssetService(cacheRoot);
    }

    public object Detect(string? preferred = null)
    {
        var result = core.Detect(preferred);
        var root = Property<string>(result, "cs2Root", null);
        if (!Property(result, "available", false) || string.IsNullOrWhiteSpace(root))
        {
            ResetDeep();
            return result;
        }
        return LoadDeep(root!);
    }

    public object Load(string root)
    {
        var result = core.Load(root);
        var resolved = Property<string>(result, "cs2Root", null);
        if (!Property(result, "available", false) || string.IsNullOrWhiteSpace(resolved))
        {
            ResetDeep();
            return result;
        }
        return LoadDeep(resolved!);
    }

    object LoadDeep(string root)
    {
        var timer = System.Diagnostics.Stopwatch.StartNew();
        ResetDeep();
        cs2Root = Path.GetFullPath(root);
        SeedCoreKeys();

        var candidates = DiscoverPackages(cs2Root).ToArray();
        officialMapPackageCount = candidates.Count(candidate => candidate.scope == "official-map");
        addonPackageCount = candidates.Count(candidate => candidate.scope == "addon");
        workshopPackageCount = candidates.Count(candidate => candidate.scope == "workshop");
        deepFingerprint = BuildFingerprint(candidates);

        if (!TryLoadCache(candidates, deepFingerprint))
        {
            IndexPackages(candidates);
            SaveCache(deepFingerprint);
        }

        timer.Stop();
        deepScanMilliseconds = timer.ElapsedMilliseconds;
        return Status();
    }

    void ResetDeep()
    {
        materials.Clear();
        models.Clear();
        sounds.Clear();
        particles.Clear();
        locations.Clear();
        unique.Clear();
        deepIndexCacheHit = false;
        indexedPackageCount = 0;
        failedPackageCount = 0;
        officialMapPackageCount = 0;
        addonPackageCount = 0;
        workshopPackageCount = 0;
        deepScanMilliseconds = 0;
        deepFingerprint = "";
        foreach (var context in previewContexts.Values) context.Dispose();
        previewContexts.Clear();
    }

    void SeedCoreKeys()
    {
        try
        {
            var field = typeof(AssetService).GetField("unique", BindingFlags.Instance | BindingFlags.NonPublic);
            if (field?.GetValue(core) is Dictionary<string, AssetItem> typed)
            {
                foreach (var key in typed.Keys) unique.Add(key);
                return;
            }
            if (field?.GetValue(core) is IDictionary dictionary)
                foreach (DictionaryEntry entry in dictionary)
                    if (entry.Key is string key) unique.Add(key);
        }
        catch { }
    }

    IEnumerable<DeepPackageCandidate> DiscoverPackages(string root)
    {
        var output = new List<DeepPackageCandidate>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var gameRoot = Path.Combine(root, "game");

        void AddTree(string folder, string scope, Func<string, string> label)
        {
            if (!Directory.Exists(folder)) return;
            IEnumerable<string> files;
            try { files = Directory.EnumerateFiles(folder, "*.vpk", SearchOption.AllDirectories); }
            catch { return; }
            foreach (var file in files)
            {
                string full;
                try { full = Path.GetFullPath(file); } catch { continue; }
                if (!IsPackageRoot(full) || !seen.Add(full)) continue;
                output.Add(new DeepPackageCandidate(full, label(full), scope));
            }
        }

        if (Directory.Exists(gameRoot))
        {
            string[] mounts;
            try { mounts = Directory.EnumerateDirectories(gameRoot).OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToArray(); }
            catch { mounts = []; }
            foreach (var mount in mounts)
            {
                var mapRoot = Path.Combine(mount, "maps");
                var mountName = Path.GetFileName(mount);
                AddTree(mapRoot, "official-map", file => $"map-vpk:{mountName}/{Normalize(Path.GetRelativePath(mount, file))}");
            }

            var addonsRoot = Path.Combine(gameRoot, "csgo_addons");
            AddTree(addonsRoot, "addon", file => $"addon-vpk:{Normalize(Path.GetRelativePath(addonsRoot, file))}");
        }

        var workshopRoot = WorkshopRootFor(root);
        if (workshopRoot is not null)
            AddTree(workshopRoot, "workshop", file => $"workshop-vpk:{Normalize(Path.GetRelativePath(workshopRoot, file))}");

        return output
            .OrderBy(candidate => candidate.scope == "official-map" ? 0 : candidate.scope == "addon" ? 1 : 2)
            .ThenBy(candidate => candidate.path, StringComparer.OrdinalIgnoreCase);
    }

    static bool IsPackageRoot(string file)
    {
        var name = Path.GetFileName(file);
        if (name.EndsWith("_dir.vpk", StringComparison.OrdinalIgnoreCase)) return true;
        var match = Regex.Match(name, "^(.*)_([0-9]{3,})\\.vpk$", RegexOptions.IgnoreCase);
        if (!match.Success) return true;
        var siblingDir = Path.Combine(Path.GetDirectoryName(file)!, match.Groups[1].Value + "_dir.vpk");
        return !File.Exists(siblingDir);
    }

    static string? WorkshopRootFor(string root)
    {
        try
        {
            var common = Directory.GetParent(Path.GetFullPath(root));
            if (common is null || !common.Name.Equals("common", StringComparison.OrdinalIgnoreCase)) return null;
            var steamapps = common.Parent;
            if (steamapps is null || !steamapps.Name.Equals("steamapps", StringComparison.OrdinalIgnoreCase)) return null;
            var workshop = Path.Combine(steamapps.FullName, "workshop", "content", "730");
            return Directory.Exists(workshop) ? workshop : null;
        }
        catch { return null; }
    }

    string BuildFingerprint(IReadOnlyList<DeepPackageCandidate> candidates)
    {
        var lines = new List<string> { $"deep-index-v{DeepIndexVersion}", Normalize(cs2Root ?? "") };
        foreach (var candidate in candidates)
        {
            try
            {
                var info = new FileInfo(candidate.path);
                lines.Add($"{candidate.scope}|{Normalize(candidate.path)}|{info.Length}|{info.LastWriteTimeUtc.Ticks}");
            }
            catch { lines.Add($"{candidate.scope}|{Normalize(candidate.path)}"); }
        }
        return Hash(string.Join("\n", lines));
    }

    string CachePath()
    {
        var rootKey = Hash(Path.GetFullPath(cs2Root ?? "unknown"));
        return Path.Combine(cacheRoot, $"deep-map-asset-index-v{DeepIndexVersion}-{rootKey[..12]}.json");
    }

    bool TryLoadCache(IReadOnlyList<DeepPackageCandidate> candidates, string fingerprint)
    {
        var path = CachePath();
        if (!File.Exists(path)) return false;
        try
        {
            var cache = JsonSerializer.Deserialize<DeepAssetIndexCache>(File.ReadAllText(path), CacheJsonOptions);
            if (cache is null
                || cache.version != DeepIndexVersion
                || !Path.GetFullPath(cache.cs2Root).Equals(Path.GetFullPath(cs2Root!), StringComparison.OrdinalIgnoreCase)
                || !cache.fingerprint.Equals(fingerprint, StringComparison.OrdinalIgnoreCase)) return false;

            var packageSet = new HashSet<string>(candidates.Select(candidate => candidate.path), StringComparer.OrdinalIgnoreCase);
            foreach (var cached in cache.assets ?? [])
            {
                if (!packageSet.Contains(cached.packagePath)) continue;
                AddDeepAsset(cached.path + "_c", cached.source, cached.packagePath, cached.name);
            }
            indexedPackageCount = cache.indexedPackageCount;
            failedPackageCount = cache.failedPackageCount;
            officialMapPackageCount = cache.officialMapPackageCount;
            addonPackageCount = cache.addonPackageCount;
            workshopPackageCount = cache.workshopPackageCount;
            deepIndexCacheHit = true;
            return true;
        }
        catch
        {
            try { File.Delete(path); } catch { }
            return false;
        }
    }

    void SaveCache(string fingerprint)
    {
        try
        {
            var assets = locations.Select(pair =>
            {
                var split = pair.Key.IndexOf(':');
                var kind = split > 0 ? pair.Key[..split] : "material";
                var path = split > 0 ? pair.Key[(split + 1)..] : pair.Key;
                var item = AssetList(kind).FirstOrDefault(asset => asset.path.Equals(path, StringComparison.OrdinalIgnoreCase));
                return new DeepCachedAsset(item?.name ?? Path.GetFileNameWithoutExtension(path).Replace('_', ' '), path, kind, item?.source ?? "map-vpk", pair.Value);
            }).ToArray();
            var payload = new DeepAssetIndexCache(
                DeepIndexVersion,
                Path.GetFullPath(cs2Root!),
                fingerprint,
                assets,
                indexedPackageCount,
                failedPackageCount,
                officialMapPackageCount,
                addonPackageCount,
                workshopPackageCount);
            var path = CachePath();
            var temp = path + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(payload, CacheJsonOptions));
            File.Move(temp, path, true);
        }
        catch { }
    }

    void IndexPackages(IReadOnlyList<DeepPackageCandidate> candidates)
    {
        foreach (var candidate in candidates)
        {
            try
            {
                using var package = new Package();
                package.Read(candidate.path);
                indexedPackageCount++;
                if (package.Entries is null) continue;
                foreach (var list in package.Entries.Values)
                foreach (var entry in list)
                    AddDeepAsset(Normalize(entry.GetFullPath()), candidate.source, candidate.path);
            }
            catch { failedPackageCount++; }
        }
    }

    void AddDeepAsset(string compiledPath, string source, string packagePath, string? explicitName = null)
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

        sourcePath = Normalize(sourcePath);
        var key = $"{kind}:{sourcePath}";
        if (!unique.Add(key)) return;
        var name = explicitName ?? Path.GetFileNameWithoutExtension(sourcePath).Replace('_', ' ');
        var item = new AssetItem(name, sourcePath, kind, source);
        AssetList(kind).Add(item);
        locations[key] = packagePath;
    }

    List<AssetItem> AssetList(string kind) => kind switch
    {
        "model" => models,
        "sound" => sounds,
        "particle" => particles,
        _ => materials,
    };

    public object Status()
    {
        var status = core.Status();
        var baseMaterials = Property(status, "materialCount", 0);
        var baseModels = Property(status, "modelCount", 0);
        var baseSounds = Property(status, "soundCount", 0);
        var baseParticles = Property(status, "particleCount", 0);
        var baseVpks = Property(status, "indexedVpkCount", 0);
        var coreCacheHit = Property(status, "indexCacheHit", false);
        return new
        {
            ok = true,
            available = Property(status, "available", false),
            cs2Root = Property<string>(status, "cs2Root", cs2Root),
            materialCount = baseMaterials + materials.Count,
            modelCount = baseModels + models.Count,
            soundCount = baseSounds + sounds.Count,
            particleCount = baseParticles + particles.Count,
            baseMaterialCount = baseMaterials,
            baseModelCount = baseModels,
            mapEmbeddedMaterialCount = materials.Count,
            mapEmbeddedModelCount = models.Count,
            mapEmbeddedSoundCount = sounds.Count,
            mapEmbeddedParticleCount = particles.Count,
            mapEmbeddedAssetCount = materials.Count + models.Count + sounds.Count + particles.Count,
            indexedVpkCount = baseVpks + indexedPackageCount,
            baseIndexedVpkCount = baseVpks,
            indexedMapPackageCount = indexedPackageCount,
            failedMapPackageCount = failedPackageCount,
            officialMapPackageCount,
            addonPackageCount,
            workshopPackageCount,
            indexedMounts = Property<string[]>(status, "indexedMounts", []),
            indexCacheHit = coreCacheHit && deepIndexCacheHit,
            deepIndexCacheHit,
            deepScanMilliseconds,
            cacheRoot = Property<string>(status, "cacheRoot", cacheRoot),
        };
    }

    public object Search(string kind, string? query, int limit)
    {
        var normalizedKind = NormalizeKind(kind);
        var q = (query ?? "").Trim();
        var max = Math.Clamp(limit, 1, 5000);
        var coreLimit = Math.Clamp(Math.Max(max * 4, 800), 1, 5000);
        var coreResult = core.Search(normalizedKind, q, coreLimit);
        var coreItems = Property<AssetItem[]>(coreResult, "items", []) ?? [];
        var coreTotal = Property(coreResult, "total", coreItems.Length);
        var deep = AssetList(normalizedKind);

        IEnumerable<AssetItem> deepResult = deep;
        if (q.Length > 0)
        {
            var words = q.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            deepResult = deepResult.Where(item => words.All(word =>
                item.path.Contains(word, StringComparison.OrdinalIgnoreCase)
                || item.name.Contains(word, StringComparison.OrdinalIgnoreCase)
                || item.source.Contains(word, StringComparison.OrdinalIgnoreCase)));
        }

        var merged = new Dictionary<string, AssetItem>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in coreItems) merged.TryAdd(item.path, item);
        foreach (var item in deepResult) merged.TryAdd(item.path, item);
        var items = merged.Values
            .OrderBy(item => SearchScore(item, q))
            .ThenBy(item => item.path.Length)
            .ThenBy(item => item.path, StringComparer.OrdinalIgnoreCase)
            .Take(max)
            .ToArray();
        return new
        {
            ok = true,
            items,
            total = coreTotal + deep.Count,
            returned = items.Length,
            kind = normalizedKind,
            mapEmbeddedTotal = deep.Count,
        };
    }

    static string NormalizeKind(string kind) => (kind ?? "material").Trim().ToLowerInvariant() switch
    {
        "model" or "models" or "prop" or "props" => "model",
        "sound" or "sounds" => "sound",
        "particle" or "particles" or "vfx" => "particle",
        _ => "material",
    };

    static int SearchScore(AssetItem item, string query)
    {
        if (string.IsNullOrWhiteSpace(query)) return item.source.StartsWith("map-vpk:", StringComparison.OrdinalIgnoreCase) ? 11 : 10;
        var q = query.Trim();
        var stem = Path.GetFileNameWithoutExtension(item.path);
        if (stem.Equals(q, StringComparison.OrdinalIgnoreCase) || item.name.Equals(q, StringComparison.OrdinalIgnoreCase)) return 0;
        if (stem.StartsWith(q, StringComparison.OrdinalIgnoreCase) || item.name.StartsWith(q, StringComparison.OrdinalIgnoreCase)) return 1;
        if (stem.Contains(q, StringComparison.OrdinalIgnoreCase) || item.name.Contains(q, StringComparison.OrdinalIgnoreCase)) return 2;
        if (item.path.Contains(q, StringComparison.OrdinalIgnoreCase)) return 3;
        if (item.source.Contains(q, StringComparison.OrdinalIgnoreCase)) return 4;
        return 5;
    }

    public object MaterialPreview(string materialPath)
    {
        var baseResult = core.MaterialPreview(materialPath);
        if (Property(baseResult, "ok", false)) return baseResult;
        var requested = NormalizeSourcePath(materialPath, ".vmat");
        if (!locations.TryGetValue($"material:{requested}", out var packagePath)) return baseResult;
        try { return MaterialPreviewFrom(GetContext(packagePath).Loader, packagePath, requested); }
        catch (Exception ex) { return new { ok = false, found = true, requested, source = packagePath, error = ex.Message }; }
    }

    public object ModelPreview(string modelPath)
    {
        var baseResult = core.ModelPreview(modelPath);
        if (Property(baseResult, "ok", false)) return baseResult;
        var requested = NormalizeSourcePath(modelPath, ".vmdl");
        if (!locations.TryGetValue($"model:{requested}", out var packagePath)) return baseResult;
        try { return ModelPreviewFrom(GetContext(packagePath).Loader, packagePath, requested); }
        catch (Exception ex) { return new { ok = false, requested, source = packagePath, error = ex.Message }; }
    }

    object MaterialPreviewFrom(GameFileLoader loader, string packagePath, string requested)
    {
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
                    if (Regex.IsMatch(pair.Key, "color|albedo|diffuse|base", RegexOptions.IgnoreCase) && !textureChoices.Any(value => value.Equals(pair.Value, StringComparison.OrdinalIgnoreCase)))
                        textureChoices.Add(pair.Value);
                }
                foreach (var value in material.TextureParams.Values)
                    if (!string.IsNullOrWhiteSpace(value) && !textureChoices.Any(existing => existing.Equals(value, StringComparison.OrdinalIgnoreCase))) textureChoices.Add(value);

                foreach (var texturePath in textureChoices)
                foreach (var sourceTexture in ResourceCandidates(texturePath, ".vtex", "materials"))
                {
                    try
                    {
                        using var textureResource = loader.LoadFileCompiled(sourceTexture);
                        if (textureResource?.DataBlock is not Texture texture) continue;
                        var cacheKey = Hash($"deep|{packagePath}|{normalized}|{sourceTexture}");
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
                        return new { ok = true, path = outPath, requested, resource = normalized, texture = sourceTexture, shader = material.ShaderName, width, height, source = packagePath };
                    }
                    catch (Exception ex) { lastError = ex.Message; }
                }
                lastError = "Material exists in the map package, but none of its texture resources could be decoded for preview.";
            }
            catch (Exception ex) { lastError = ex.Message; }
        }
        return new { ok = false, found = materialFound, requested, source = packagePath, error = lastError ?? "Map material could not be decoded." };
    }

    object ModelPreviewFrom(GameFileLoader loader, string packagePath, string requested)
    {
        foreach (var normalized in ResourceCandidates(requested, ".vmdl", null))
        {
            try
            {
                var key = Hash($"deep|{packagePath}|{normalized}");
                var outPath = Path.Combine(cacheRoot, "models", key + ".glb");
                if (File.Exists(outPath)) return new { ok = true, path = outPath, resource = normalized, scale = 39.37007874015748, source = packagePath };
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
                return new { ok = true, path = outPath, resource = normalized, scale = 39.37007874015748, source = packagePath };
            }
            catch { }
        }
        return new { ok = false, requested, source = packagePath, error = "Map model could not be decoded from its standalone VPK." };
    }

    DeepPackageContext GetContext(string packagePath)
    {
        if (previewContexts.TryGetValue(packagePath, out var existing))
        {
            existing.LastUse = Environment.TickCount64;
            return existing;
        }
        if (previewContexts.Count >= PreviewContextLimit)
        {
            var oldest = previewContexts.OrderBy(pair => pair.Value.LastUse).First();
            previewContexts.Remove(oldest.Key);
            oldest.Value.Dispose();
        }
        var context = new DeepPackageContext(packagePath);
        previewContexts[packagePath] = context;
        return context;
    }

    static IEnumerable<string> ResourceCandidates(string value, string extension, string? conventionalPrefix)
    {
        var normalized = NormalizeSourcePath(value, extension);
        var output = new List<string>();
        void Add(string candidate)
        {
            candidate = NormalizeSourcePath(candidate, extension);
            if (!output.Any(existing => existing.Equals(candidate, StringComparison.OrdinalIgnoreCase))) output.Add(candidate);
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

    static string NormalizeSourcePath(string value, string extension)
    {
        var path = Normalize(value);
        if (path.EndsWith("_c", StringComparison.OrdinalIgnoreCase)) path = path[..^2];
        if (!path.EndsWith(extension, StringComparison.OrdinalIgnoreCase)) path += extension;
        return path;
    }

    static string Normalize(string value) => value.Replace('\\', '/').TrimStart('/');

    static string Hash(string value)
    {
        var bytes = System.Security.Cryptography.SHA1.HashData(System.Text.Encoding.UTF8.GetBytes(value.ToLowerInvariant()));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    static T Property<T>(object value, string name, T fallback)
    {
        try
        {
            var property = value.GetType().GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.IgnoreCase);
            var raw = property?.GetValue(value);
            if (raw is T typed) return typed;
            if (raw is null) return fallback;
            return (T)Convert.ChangeType(raw, typeof(T));
        }
        catch { return fallback; }
    }

    public object HammerInfo() => core.HammerInfo();

    public void Dispose()
    {
        ResetDeep();
        core.Dispose();
    }
}

static class DeepProgram
{
    static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    static async Task Main(string[] args)
    {
        var cache = Arg(args, "--cache") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "EasyPeasyHammer", "AssetCache");
        var preferred = Arg(args, "--cs2");
        using var service = new DeepAssetService(cache);
        var initialized = false;

        object EnsureInitialized()
        {
            if (initialized) return service.Status();
            var result = service.Detect(preferred);
            initialized = true;
            return result;
        }

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
                var argsElement = request.args;
                var command = (request.command ?? "").ToLowerInvariant();
                if (command == "ping") result = new { ok = true, version = "1.4-map-vpk" };
                else
                {
                    EnsureInitialized();
                    result = command switch
                    {
                        "status" => service.Status(),
                        "detect" => service.Detect(GetString(argsElement, "path")),
                        "set-path" => SetPath(service, argsElement, ref initialized),
                        "search" => service.Search(GetString(argsElement, "kind") ?? "material", GetString(argsElement, "query"), GetInt(argsElement, "limit", 200)),
                        "material-preview" => service.MaterialPreview(GetString(argsElement, "path") ?? ""),
                        "model-preview" => service.ModelPreview(GetString(argsElement, "path") ?? ""),
                        "hammer-info" => service.HammerInfo(),
                        _ => new { ok = false, error = "Unknown command." }
                    };
                }
            }
            catch (Exception ex)
            {
                result = new { ok = false, error = ex.Message };
            }
            Console.WriteLine(JsonSerializer.Serialize(new { id, result }, JsonOptions));
            Console.Out.Flush();
        }
    }

    static object SetPath(DeepAssetService service, JsonElement args, ref bool initialized)
    {
        var path = GetString(args, "path") ?? "";
        var result = service.Load(path);
        initialized = true;
        return result;
    }

    static string? Arg(string[] args, string key)
    {
        var index = Array.FindIndex(args, value => value.Equals(key, StringComparison.OrdinalIgnoreCase));
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    static string? GetString(JsonElement element, string name) => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    static int GetInt(JsonElement element, string name, int fallback) => element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value) && value.TryGetInt32(out var number) ? number : fallback;
}
