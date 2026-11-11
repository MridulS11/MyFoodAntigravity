"use client";

import Link from "next/link";
import { Star, Heart } from "lucide-react";
import { useFavorites, useToggleFavorite } from "@/hooks/useGoodlyQueries";

export default function AccountFavoritesPage() {
  const { data: favorites = [] } = useFavorites();
  const toggleFav = useToggleFavorite();

  return (
    <div className="max-w-[960px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <Link href="/account/profile" className="text-xs text-[#5F8E63] hover:underline">
          ← Back to account
        </Link>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Favorite kitchens
        </h1>
      </div>

      {favorites.length === 0 ? (
        <div className="bg-white border border-[#E8E3D5] rounded-2xl p-10 text-center">
          <p className="font-bold text-sm">No favorite restaurants saved yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {favorites.map((rest) => (
            <div
              key={rest.id}
              className="bg-white border border-[#E8E3D5] rounded-2xl overflow-hidden"
            >
              <img
                src={rest.cardImageUrl}
                alt={rest.name}
                className="w-full h-40 object-cover"
              />
              <div className="p-4 flex items-center justify-between">
                <Link href={`/restaurants/${rest.slug}`}>
                  <h2 className="font-bold text-base hover:text-[#5F8E63]">
                    {rest.name}
                  </h2>
                  <p className="text-xs text-[#8A8880]">
                    {rest.cuisines.join(" · ")} ·{" "}
                    <Star className="inline w-3 h-3 fill-[#DEC146] text-[#DEC146]" />{" "}
                    {rest.ratingAverage.toFixed(1)}
                  </p>
                </Link>
                <button
                  type="button"
                  onClick={() => toggleFav.mutate(rest.id)}
                  className="w-8 h-8 rounded-full bg-[#CBEAD0] flex items-center justify-center"
                  aria-label={`Remove ${rest.name} from favorites`}
                >
                  <Heart className="w-4 h-4 fill-[#1E1F1C] text-[#1E1F1C]" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
