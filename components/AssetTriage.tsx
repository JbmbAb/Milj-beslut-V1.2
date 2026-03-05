import React, { useMemo, useState } from "react";
import { classifyAsset } from "../services/geminiService";

interface Asset {
  id: string;
  url: string;
  category?: string;
  confidence?: number;
  status: "pending" | "reviewed" | "trashed";
}

type AssetFilter = "ALL" | "SIGNATUR" | "KOMMUNVAPEN" | "SKRAP";

const confidenceByCategory: Record<string, number> = {
  KOMMUNVAPEN: 0.93,
  SIGNATUR: 0.91,
  STAMPEL: 0.89,
  RITNINGS_DEL: 0.87,
  SKRAP: 0.95,
};

const AssetTriage: React.FC = () => {
  const [assets, setAssets] = useState<Asset[]>(
    Array.from({ length: 24 }).map((_, index) => ({
      id: `asset-${index}`,
      url: `https://picsum.photos/seed/${index + 500}/300/150`,
      status: "pending",
    }))
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<AssetFilter>("ALL");
  const [progress, setProgress] = useState(0);

  const filteredAssets = useMemo(() => {
    if (activeFilter === "ALL") return assets;
    return assets.filter((asset) => asset.category === activeFilter);
  }, [assets, activeFilter]);

  const normalizeCategory = (value: string): string => {
    const normalized = value
      .toUpperCase()
      .replace(/Ä/g, "A")
      .replace(/Ö/g, "O");
    if (normalized === "STAMPEL") return "STAMPEL";
    if (normalized === "SKRAP") return "SKRAP";
    if (normalized === "KOMMUNVAPEN") return "KOMMUNVAPEN";
    if (normalized === "SIGNATUR") return "SIGNATUR";
    if (normalized === "RITNINGS_DEL") return "RITNINGS_DEL";
    return "RITNINGS_DEL";
  };

  const handleClassify = async (asset: Asset) => {
    const rawCategory = await classifyAsset(asset.url, "image/jpeg");
    const category = normalizeCategory(rawCategory);
    setAssets((prev) =>
      prev.map((item) =>
        item.id === asset.id ? { ...item, category, confidence: confidenceByCategory[category] || 0.86 } : item
      )
    );
  };

  const processAll = async () => {
    setIsProcessing(true);
    setProgress(0);
    const candidates = assets.filter((asset) => !asset.category);
    const total = candidates.length || 1;
    let count = 0;

    for (const asset of candidates) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await handleClassify(asset);
      count += 1;
      setProgress(Math.round((count / total) * 100));
    }
    setIsProcessing(false);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col items-start justify-between gap-6 rounded-[2.5rem] border border-slate-200 bg-white p-8 shadow-sm md:flex-row md:items-center">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <span className="rounded border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-600 shadow-sm">
              721 filer i ko
            </span>
            <h2 className="text-3xl font-black tracking-tight text-slate-900">Resurshantering och triage</h2>
          </div>
          <p className="text-sm text-slate-500">Automatisera granskning av logotyper, signaturer och stamplar i dokumentarkivet.</p>
        </div>

        <div className="flex flex-col items-end gap-3">
          <button
            type="button"
            onClick={() => void processAll()}
            disabled={isProcessing}
            className="flex items-center gap-3 rounded-2xl bg-blue-600 px-8 py-4 font-black text-white shadow-xl shadow-blue-600/20 transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-50"
          >
            {isProcessing ? <i className="fas fa-spinner fa-spin" /> : <i className="fas fa-robot" />}
            {isProcessing ? `Bearbetar: ${progress}%` : "AI-klassificera alla"}
          </button>
          {isProcessing && (
            <div className="h-1.5 w-full overflow-hidden rounded-full border border-slate-200 bg-slate-100">
              <div className="h-full bg-blue-600 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        <FilterTab active={activeFilter === "ALL"} onClick={() => setActiveFilter("ALL")} label="Alla fragment" count={assets.length} />
        <FilterTab
          active={activeFilter === "SIGNATUR"}
          onClick={() => setActiveFilter("SIGNATUR")}
          label="Signaturer"
          count={assets.filter((asset) => asset.category === "SIGNATUR").length}
        />
        <FilterTab
          active={activeFilter === "KOMMUNVAPEN"}
          onClick={() => setActiveFilter("KOMMUNVAPEN")}
          label="Kommunvapen"
          count={assets.filter((asset) => asset.category === "KOMMUNVAPEN").length}
        />
        <FilterTab
          active={activeFilter === "SKRAP"}
          onClick={() => setActiveFilter("SKRAP")}
          label="Skrap"
          count={assets.filter((asset) => asset.category === "SKRAP").length}
        />
      </div>

      <div className="grid grid-cols-2 gap-6 md:grid-cols-4 lg:grid-cols-6">
        {filteredAssets.map((asset) => (
          <div
            key={asset.id}
            className="group relative animate-in zoom-in overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:border-blue-300 hover:shadow-2xl"
          >
            <div className="relative flex aspect-[3/2] items-center justify-center bg-slate-50 p-4 transition-colors group-hover:bg-white">
              <img src={asset.url} alt="Fragment" className="max-h-full max-w-full object-contain mix-blend-multiply drop-shadow-sm" />
              {asset.category === "SIGNATUR" && (
                <div className="absolute right-2 top-2 flex h-6 w-6 animate-pulse items-center justify-center rounded-full bg-amber-500 text-[10px] text-white shadow-lg">
                  <i className="fas fa-pen-nib" />
                </div>
              )}
            </div>

            <div className="border-t border-slate-50 bg-white p-4">
              {asset.category ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                        asset.category === "SKRAP"
                          ? "bg-slate-100 text-slate-400"
                          : asset.category === "SIGNATUR"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-indigo-100 text-indigo-700"
                      }`}
                    >
                      {asset.category}
                    </span>
                    <span className="text-[10px] font-black text-slate-300">{((asset.confidence || 0) * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex gap-2">
                    <button className="flex-1 rounded-lg border border-slate-100 bg-slate-50 py-1.5 text-slate-400 transition-colors hover:border-red-100 hover:text-red-500">
                      <i className="fas fa-trash text-[10px]" />
                    </button>
                    <button className="flex-1 rounded-lg border border-blue-100 bg-blue-50 py-1.5 text-blue-600 transition-all hover:bg-blue-600 hover:text-white">
                      <i className="fas fa-check text-[10px]" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleClassify(asset)}
                  className="w-full rounded-xl border border-dashed border-slate-200 bg-slate-50 py-2.5 text-[10px] font-black text-slate-400 transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                >
                  KLASSIFICERA
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const FilterTab: React.FC<{ active: boolean; onClick: () => void; label: string; count: number }> = ({
  active,
  onClick,
  label,
  count,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-3 rounded-full border px-5 py-2.5 text-xs font-black transition-all ${
      active ? "border-slate-900 bg-slate-900 text-white shadow-lg" : "border-slate-200 bg-white text-slate-500 hover:border-slate-400"
    }`}
  >
    {label}
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-400"}`}>{count}</span>
  </button>
);

export default AssetTriage;
