"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Flame, Plus, Sparkles, Tag, Trash2, Upload, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VegClassificationBadge } from "@/components/shared/VegClassificationBadge";
import { formatMinor } from "@/lib/format";
import { uploadMediaWithPresign } from "@/lib/mediaUpload";
import { menuItemSchema } from "@/lib/validators/schemas";
import { services } from "@/services";
import type {
  CustomizationGroup,
  MenuItem,
  VegClassification,
} from "@/services/contracts/types";
import { useAppStore } from "@/stores/useAppStore";

type MenuItemFormValues = z.infer<typeof menuItemSchema>;

const DIETARY_PRESETS = [
  "Vegetarian",
  "Vegan",
  "Gluten-Free",
  "High Protein",
  "Jain",
  "Keto",
  "Nut-Free",
];

const ALLERGEN_PRESETS = ["Gluten", "Dairy", "Nuts", "Soy", "Eggs", "Shellfish"];

function splitCommaList(val: string): string[] {
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function RestaurantMenuPage() {
  const qc = useQueryClient();
  const pushToast = useAppStore((s) => s.pushToast);

  const { data, isLoading } = useQuery({
    queryKey: ["myRestaurant"],
    queryFn: () => services.restaurantPortal.getMyRestaurant(),
  });

  const [newCategoryName, setNewCategoryName] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [editingItem, setEditingItem] = useState<Partial<MenuItem> | null>(null);
  const [vegClassification, setVegClassification] = useState<VegClassification>("VEG");
  const [dietaryTags, setDietaryTags] = useState<string[]>([]);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [ingredientsText, setIngredientsText] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [customizationGroups, setCustomizationGroups] = useState<CustomizationGroup[]>([]);

  const form = useForm<MenuItemFormValues>({
    resolver: zodResolver(menuItemSchema),
  });

  if (isLoading || !data) {
    return <div className="text-sm text-[#8A8880]">Loading menu manager...</div>;
  }

  const { categories } = data;

  async function handleToggleAvailability(item: MenuItem) {
    await services.restaurantPortal.toggleMenuItemAvailability(
      item.id,
      !item.isAvailable
    );
    await qc.invalidateQueries({ queryKey: ["myRestaurant"] });
    await qc.invalidateQueries({ queryKey: ["restaurantMenu"] });
    pushToast(
      "info",
      `${item.name} marked ${!item.isAvailable ? "In Stock" : "Sold Out"}.`
    );
  }

  async function handleAddCategory() {
    if (!newCategoryName.trim()) return;
    await services.restaurantPortal.createCategory({ name: newCategoryName.trim() });
    setNewCategoryName("");
    await qc.invalidateQueries({ queryKey: ["myRestaurant"] });
    pushToast("success", "Category created.");
  }

  function openDishDrawer(item?: MenuItem) {
    if (item) {
      setEditingItem(item);
      setVegClassification(item.vegClassification ?? "VEG");
      setDietaryTags(item.dietaryTags ?? []);
      setAllergens(item.allergens ?? []);
      setIngredientsText((item.ingredients ?? []).join(", "));
      setKeywordsText((item.searchKeywords ?? []).join(", "));
      setCustomizationGroups(
        (item.customizationGroups ?? []).map((g) => ({
          ...g,
          options: g.options.map((o) => ({ ...o })),
        }))
      );
      form.reset({
        categoryId: item.categoryId,
        name: item.name,
        description: item.description,
        badgeLabel: item.badgeLabel ?? "",
        basePriceDollars: item.basePriceMinor / 100,
        trackInventory: item.trackInventory,
        availableQuantity: item.availableQuantity,
        imageUrl: item.imageUrl ?? "",
        cuisineType: item.cuisineType ?? "",
        spiceLevel: item.spiceLevel ?? "NONE",
        prepTimeMinutes: item.prepTimeMinutes ?? null,
        caloriesKcal: item.caloriesKcal ?? null,
        servingSize: item.servingSize ?? "",
        isRecommended: Boolean(item.isRecommended),
      });
    } else {
      setEditingItem({});
      setVegClassification("VEG");
      setDietaryTags([]);
      setAllergens([]);
      setIngredientsText("");
      setKeywordsText("");
      setCustomizationGroups([]);
      form.reset({
        categoryId: categories[0]?.id ?? "",
        name: "",
        description: "",
        badgeLabel: "",
        basePriceDollars: 320,
        trackInventory: false,
        availableQuantity: 25,
        imageUrl: "",
        cuisineType: "",
        spiceLevel: "NONE",
        prepTimeMinutes: 18,
        caloriesKcal: null,
        servingSize: "",
        isRecommended: false,
      });
    }
  }

  function toggleTag(list: string[], setList: (v: string[]) => void, value: string) {
    setList(list.includes(value) ? list.filter((t) => t !== value) : [...list, value]);
  }

  function addCustomGroup() {
    setCustomizationGroups((prev) => [
      ...prev,
      {
        id: `grp-${Date.now()}-${prev.length}`,
        name: "",
        minSelections: 0,
        maxSelections: 1,
        isRequired: false,
        options: [
          {
            id: `opt-${Date.now()}-0`,
            name: "",
            priceDeltaMinor: 0,
            isDefault: false,
            isAvailable: true,
          },
        ],
      },
    ]);
  }

  function updateGroup(idx: number, patch: Partial<CustomizationGroup>) {
    setCustomizationGroups((prev) =>
      prev.map((g, i) => (i === idx ? { ...g, ...patch } : g))
    );
  }

  function addOption(grpIdx: number) {
    setCustomizationGroups((prev) =>
      prev.map((g, i) =>
        i === grpIdx
          ? {
              ...g,
              options: [
                ...g.options,
                {
                  id: `opt-${Date.now()}-${g.options.length}`,
                  name: "",
                  priceDeltaMinor: 0,
                  isDefault: false,
                  isAvailable: true,
                },
              ],
            }
          : g
      )
    );
  }

  async function onSaveDish(values: MenuItemFormValues) {
    const cleanedGroups = customizationGroups
      .filter((g) => g.name.trim() !== "")
      .map((g) => ({
        ...g,
        name: g.name.trim(),
        options: g.options
          .filter((o) => o.name.trim() !== "")
          .map((o) => ({ ...o, name: o.name.trim() })),
      }));

    await services.restaurantPortal.upsertMenuItem({
      id: editingItem?.id,
      categoryId: values.categoryId,
      name: values.name,
      description: values.description,
      badgeLabel: values.badgeLabel || undefined,
      vegClassification,
      basePriceMinor: Math.round(values.basePriceDollars * 100),
      trackInventory: values.trackInventory,
      availableQuantity: values.availableQuantity,
      imageUrl: values.imageUrl?.trim() || undefined,
      dietaryTags,
      cuisineType: values.cuisineType?.trim() || undefined,
      spiceLevel: values.spiceLevel ?? "NONE",
      prepTimeMinutes:
        typeof values.prepTimeMinutes === "number" && !Number.isNaN(values.prepTimeMinutes)
          ? values.prepTimeMinutes
          : undefined,
      caloriesKcal:
        typeof values.caloriesKcal === "number" && !Number.isNaN(values.caloriesKcal)
          ? values.caloriesKcal
          : undefined,
      servingSize: values.servingSize?.trim() || undefined,
      ingredients: splitCommaList(ingredientsText),
      allergens,
      searchKeywords: splitCommaList(keywordsText),
      isRecommended: Boolean(values.isRecommended),
      customizationGroups: cleanedGroups,
    });
    await qc.invalidateQueries({ queryKey: ["myRestaurant"] });
    await qc.invalidateQueries({ queryKey: ["restaurantMenu"] });
    setEditingItem(null);
    pushToast("success", "Menu dish saved and synced to OpenSearch!");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
            MENU &amp; INVENTORY
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#1E1F1C] mt-1">
            Dishes, culinary details &amp; availability
          </h1>
        </div>
        <button
          type="button"
          onClick={() => openDishDrawer()}
          className="inline-flex items-center gap-2 bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-xs px-4 py-2.5 rounded-xl"
        >
          <Plus className="w-4 h-4" />
          <span>Add new dish</span>
        </button>
      </div>

      {/* Quick Category Creator */}
      <div className="bg-white border border-[#E8E3D5] rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="New category name (e.g. Desserts)..."
          className="flex-1 min-w-[200px] bg-[#FCF9F0] border border-[#E8E3D5] rounded-xl px-3.5 py-2 text-xs"
        />
        <button
          type="button"
          onClick={handleAddCategory}
          className="px-4 py-2 rounded-xl bg-[#1E1F1C] text-[#FCF9F0] text-xs font-bold"
        >
          Add Category
        </button>
      </div>

      {/* Visibility Reminder when kitchen has 0 active dishes */}
      {categories.every((c) => c.items.filter((i) => i.isActive).length === 0) && (
        <div
          data-testid="menu-empty-visibility-notice"
          className="rounded-xl border border-[#DEC146] bg-[#FCF9F0] px-4 py-3 text-xs text-[#1E1F1C]"
        >
          <strong>Menu required for discovery:</strong> Add at least one category and one active dish below before this kitchen appears on Customer Discovery &amp; Search.
        </div>
      )}

      {/* Categories & Dishes */}
      <div className="space-y-6">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="bg-white border border-[#E8E3D5] rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#E8E3D5] pb-3">
              <div>
                <h2 className="text-lg font-bold text-[#1E1F1C]">{cat.name}</h2>
                {cat.subtitle && (
                  <p className="text-xs text-[#8A8880]">{cat.subtitle}</p>
                )}
              </div>
              <span className="text-xs text-[#8A8880]">
                {cat.items.length} items
              </span>
            </div>

            <div className="divide-y divide-[#E8E3D5]">
              {cat.items.map((item) => (
                <div
                  key={item.id}
                  className="py-3.5 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={item.imageUrl}
                      alt={item.name}
                      className="w-14 h-14 rounded-lg object-cover border border-[#E8E3D5]"
                    />
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <VegClassificationBadge classification={item.vegClassification} />
                        <span className="font-bold text-sm text-[#1E1F1C]">
                          {item.name}
                        </span>
                        {item.isRecommended && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#F5EBA8] text-[10px] font-bold text-[#1E1F1C]">
                            <Sparkles className="w-2.5 h-2.5" /> Chef Pick
                          </span>
                        )}
                        {item.cuisineType && (
                          <span className="px-1.5 py-0.5 rounded bg-[#FCF9F0] border border-[#E8E3D5] text-[10px] font-semibold text-[#5E5D57]">
                            {item.cuisineType}
                          </span>
                        )}
                        {item.spiceLevel && item.spiceLevel !== "NONE" && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#FDECEA] text-[10px] font-bold text-[#C62828]">
                            <Flame className="w-2.5 h-2.5" /> {item.spiceLevel}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#5E5D57] tabular-nums">
                        {formatMinor(item.basePriceMinor, item.currency)}
                        {item.servingSize ? ` · ${item.servingSize}` : ""}
                        {item.prepTimeMinutes ? ` · ${item.prepTimeMinutes}m prep` : ""}
                        {item.caloriesKcal ? ` · ${item.caloriesKcal} kcal` : ""}
                        {item.trackInventory &&
                          ` · ${item.availableQuantity} portions left`}
                        {item.customizationGroups.length > 0 &&
                          ` · ${item.customizationGroups.length} option group(s)`}
                      </div>
                      {((item.dietaryTags && item.dietaryTags.length > 0) ||
                        (item.searchKeywords && item.searchKeywords.length > 0)) && (
                        <div className="flex flex-wrap gap-1">
                          {item.dietaryTags?.map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 rounded bg-[#E8F5E9] text-[#1B5E20] text-[10px] font-semibold"
                            >
                              {t}
                            </span>
                          ))}
                          {item.searchKeywords?.map((kw) => (
                            <span
                              key={kw}
                              className="px-1.5 py-0.5 rounded bg-[#FCF9F0] border border-[#E8E3D5] text-[10px] text-[#8A8880] font-mono"
                            >
                              #{kw}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      data-testid={`toggle-stock-${item.id}`}
                      onClick={() => handleToggleAvailability(item)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border ${
                        item.isAvailable
                          ? "bg-[#E8F5E9] text-[#1B5E20] border-[#A5D6A7]"
                          : "bg-[#FDECEA] text-[#C62828] border-[#FAC8C3]"
                      }`}
                    >
                      {item.isAvailable ? "In Stock" : "Sold Out"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openDishDrawer(item)}
                      className="px-3 py-1.5 rounded-lg border border-[#E8E3D5] text-xs font-semibold hover:bg-[#F5F0E2]"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Rich Add/Edit Dish Drawer */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
          <div className="w-full max-w-xl bg-[#FCF9F0] h-full border-l border-[#E8E3D5] p-6 overflow-y-auto space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">
                {editingItem.id ? "Edit Dish Details" : "Add New Dish"}
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1.5 rounded-lg hover:bg-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={form.handleSubmit(onSaveDish)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Category</label>
                  <select
                    {...form.register("categoryId")}
                    className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Course / Dish Cuisine Type
                  </label>
                  <input
                    data-testid="dish-cuisine-input"
                    {...form.register("cuisineType")}
                    placeholder="e.g. Pasta, Wood-Fired Pizza"
                    className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5">
                  Food Classification (Required)
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { value: "VEG", label: "Veg", dot: "bg-[#2E7D32]", border: "border-[#2E7D32]" },
                      { value: "NON_VEG", label: "Non-Veg", dot: "bg-[#C62828]", border: "border-[#C62828]" },
                      { value: "EGG_ONLY", label: "Non-Veg (Only Egg)", dot: "bg-[#D97706]", border: "border-[#B45309]" },
                    ] as const
                  ).map((opt) => {
                    const active = vegClassification === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`veg-class-${opt.value}`}
                        onClick={() => setVegClassification(opt.value)}
                        className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl border text-[11px] font-bold transition-colors ${
                          active
                            ? "bg-[#1E1F1C] text-[#FCF9F0] border-[#1E1F1C]"
                            : "bg-white text-[#5E5D57] border-[#E8E3D5] hover:bg-[#F5F0E2]"
                        }`}
                      >
                        <span
                          className={`w-3 h-3 rounded-[2px] border ${opt.border} bg-white flex items-center justify-center shrink-0`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
                        </span>
                        <span className="truncate">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Dish name</label>
                <input
                  data-testid="dish-name-input"
                  {...form.register("name")}
                  placeholder="e.g. Penne Arrabbiata"
                  className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                />
                {form.formState.errors.name && (
                  <p className="text-xs text-[#C62828] mt-1">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Description</label>
                <textarea
                  data-testid="dish-desc-input"
                  rows={2}
                  {...form.register("description")}
                  placeholder="Preparation style, sauces, garnish, texture..."
                  className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Price (₹)</label>
                  <input
                    type="number"
                    step="1"
                    {...form.register("basePriceDollars", { valueAsNumber: true })}
                    className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Spice Level</label>
                  <select
                    data-testid="dish-spice-select"
                    {...form.register("spiceLevel")}
                    className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="NONE">None</option>
                    <option value="MILD">Mild</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HOT">Hot</option>
                    <option value="EXTRA_HOT">Extra Hot</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Prep (min)</label>
                  <input
                    type="number"
                    data-testid="dish-prep-input"
                    {...form.register("prepTimeMinutes", {
                      setValueAs: (v) => (v === "" ? null : Number(v)),
                    })}
                    placeholder="20"
                    className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Calories</label>
                  <input
                    type="number"
                    data-testid="dish-calories-input"
                    {...form.register("caloriesKcal", {
                      setValueAs: (v) => (v === "" ? null : Number(v)),
                    })}
                    placeholder="520"
                    className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Serving Size</label>
                  <input
                    data-testid="dish-serving-input"
                    {...form.register("servingSize")}
                    placeholder="350g · Serves 1"
                    className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Tag Badge</label>
                  <input
                    {...form.register("badgeLabel")}
                    placeholder="e.g. CHEF SPECIAL"
                    className="w-full bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Dish Image</label>
                  <div className="flex items-center gap-2">
                    <input
                      data-testid="dish-image-input"
                      {...form.register("imageUrl")}
                      placeholder="https://... or upload"
                      className="flex-1 min-w-0 bg-white border border-[#E8E3D5] rounded-xl px-3 py-2 text-xs"
                    />
                    <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E8E3D5] bg-white text-xs font-semibold cursor-pointer hover:bg-[#FCF9F0] shrink-0">
                      <Upload className="w-3.5 h-3.5 text-[#5F8E63]" />
                      {uploadingImage ? "Uploading..." : "Upload"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        className="hidden"
                        disabled={uploadingImage}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setUploadingImage(true);
                          try {
                            const res = await uploadMediaWithPresign(services.restaurantPortal, {
                              category: "Menu",
                              outletId: data.restaurant.id,
                              file,
                            });
                            form.setValue("imageUrl", res.viewUrl, { shouldDirty: true });
                            pushToast("success", "Dish image uploaded to R2 (Menu key).");
                          } catch (err) {
                            pushToast(
                              "error",
                              err instanceof Error ? err.message : "Image upload failed."
                            );
                          } finally {
                            setUploadingImage(false);
                            e.target.value = "";
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Dietary & Allergen Chips */}
              <div className="bg-white border border-[#E8E3D5] rounded-xl p-3 space-y-3">
                <div>
                  <div className="text-xs font-bold text-[#1E1F1C] mb-1.5">Dietary Tags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {DIETARY_PRESETS.map((tag) => {
                      const active = dietaryTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          data-testid={`dietary-tag-${tag}`}
                          onClick={() => toggleTag(dietaryTags, setDietaryTags, tag)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                            active
                              ? "bg-[#1E1F1C] text-[#FCF9F0] border-[#1E1F1C]"
                              : "bg-[#FCF9F0] text-[#5E5D57] border-[#E8E3D5]"
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-[#1E1F1C] mb-1.5">
                    Allergen Declarations
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ALLERGEN_PRESETS.map((al) => {
                      const active = allergens.includes(al);
                      return (
                        <button
                          key={al}
                          type="button"
                          data-testid={`allergen-tag-${al}`}
                          onClick={() => toggleTag(allergens, setAllergens, al)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                            active
                              ? "bg-[#C62828] text-white border-[#C62828]"
                              : "bg-[#FCF9F0] text-[#5E5D57] border-[#E8E3D5]"
                          }`}
                        >
                          {al}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Ingredients & OpenSearch Synonyms/Keywords */}
              <div className="bg-white border border-[#E8E3D5] rounded-xl p-3 space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">
                    Key Ingredients (comma-separated)
                  </label>
                  <input
                    data-testid="dish-ingredients-input"
                    value={ingredientsText}
                    onChange={(e) => setIngredientsText(e.target.value)}
                    placeholder="Durum wheat semolina, Garlic, Olive oil, Basil"
                    className="w-full bg-[#FCF9F0] border border-[#E8E3D5] rounded-lg px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold mb-1">
                    <Tag className="w-3.5 h-3.5 text-[#5F8E63]" />
                    <span>Search Keywords &amp; Aliases (OpenSearch-indexed)</span>
                  </label>
                  <input
                    data-testid="dish-keywords-input"
                    value={keywordsText}
                    onChange={(e) => setKeywordsText(e.target.value)}
                    placeholder="pasta, artisan, italian bowl, dinner favorite"
                    className="w-full bg-[#FCF9F0] border border-[#E8E3D5] rounded-lg px-3 py-1.5 text-xs"
                  />
                  <p className="text-[10px] text-[#8A8880] mt-1">
                    OpenSearch automatically matches food families (e.g. &ldquo;pasta&rdquo; locates penne, spaghetti, fettuccine, rigatoni) plus any custom keywords or ingredients you enter here.
                  </p>
                </div>
              </div>

              {/* Customization Groups & Add-Ons Builder */}
              <div className="bg-white border border-[#E8E3D5] rounded-xl p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-[#1E1F1C]">
                      Customization Groups &amp; Variants
                    </div>
                    <div className="text-[10px] text-[#8A8880]">
                      Add pasta shapes, portion sizes, crusts, or extra toppings.
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="add-custom-group-btn"
                    onClick={addCustomGroup}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FCF9F0] border border-[#E8E3D5] text-[11px] font-bold hover:bg-[#F5F0E2]"
                  >
                    <Plus className="w-3 h-3" /> Add Group
                  </button>
                </div>
                {customizationGroups.map((grp, gIdx) => (
                  <div
                    key={grp.id}
                    className="p-2.5 rounded-lg bg-[#FCF9F0] border border-[#E8E3D5] space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={grp.name}
                        onChange={(e) => updateGroup(gIdx, { name: e.target.value })}
                        placeholder="Group name (e.g. Choose Pasta Shape)"
                        className="flex-1 bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-1 text-xs font-semibold"
                      />
                      <label className="flex items-center gap-1 text-[11px] font-semibold">
                        <input
                          type="checkbox"
                          checked={grp.isRequired}
                          onChange={(e) =>
                            updateGroup(gIdx, {
                              isRequired: e.target.checked,
                              minSelections: e.target.checked ? 1 : 0,
                            })
                          }
                        />
                        Req
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setCustomizationGroups((prev) => prev.filter((_, i) => i !== gIdx))
                        }
                        className="p-1 text-[#C62828] hover:bg-white rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="space-y-1.5 pl-2">
                      {grp.options.map((opt, oIdx) => (
                        <div key={opt.id} className="flex items-center gap-2">
                          <input
                            value={opt.name}
                            onChange={(e) => {
                              const nextOpts = grp.options.map((o, i) =>
                                i === oIdx ? { ...o, name: e.target.value } : o
                              );
                              updateGroup(gIdx, { options: nextOpts });
                            }}
                            placeholder="Option (e.g. Fettuccine)"
                            className="flex-1 bg-white border border-[#E8E3D5] rounded-lg px-2.5 py-1 text-[11px]"
                          />
                          <input
                            type="number"
                            value={Math.round(opt.priceDeltaMinor / 100)}
                            onChange={(e) => {
                              const nextOpts = grp.options.map((o, i) =>
                                i === oIdx
                                  ? { ...o, priceDeltaMinor: (Number(e.target.value) || 0) * 100 }
                                  : o
                              );
                              updateGroup(gIdx, { options: nextOpts });
                            }}
                            placeholder="+₹"
                            className="w-16 bg-white border border-[#E8E3D5] rounded-lg px-2 py-1 text-[11px]"
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addOption(gIdx)}
                        className="text-[11px] font-bold text-[#5F8E63] hover:underline"
                      >
                        + Add Option
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Recommended & Inventory */}
              <div className="bg-white border border-[#E8E3D5] rounded-xl p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    data-testid="dish-recommended-checkbox"
                    {...form.register("isRecommended")}
                  />
                  <span>Highlight as Chef Recommended / Bestseller</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <input type="checkbox" {...form.register("trackInventory")} />
                  <span>Track finite daily stock count</span>
                </label>
                <div>
                  <label className="block text-[11px] text-[#8A8880] mb-1">
                    Available portions
                  </label>
                  <input
                    type="number"
                    {...form.register("availableQuantity", { valueAsNumber: true })}
                    className="w-full border border-[#E8E3D5] rounded-lg px-3 py-1.5 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-[#DEC146] hover:bg-[#CFAF32] text-[#1E1F1C] font-bold text-xs py-3 rounded-xl"
              >
                Save dish
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
