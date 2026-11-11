import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/components/providers/AppProviders";
import CustomerDiscoveryPage from "@/app/(customer)/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

describe("CustomerDiscoveryPage UI Component", () => {
  it("renders Goodly editorial hero and filters restaurants by category pill", async () => {
    const user = userEvent.setup();
    render(
      <AppProviders>
        <CustomerDiscoveryPage />
      </AppProviders>
    );

    expect(await screen.findByText(/Order from Sunday Table/i)).toBeInTheDocument();
    expect(screen.getByText(/Good things nearby/i)).toBeInTheDocument();
    expect(screen.getByText(/Little Green Bowl/i)).toBeInTheDocument();

    const healthyPill = screen.getByTestId("category-pill-healthy");
    await user.click(healthyPill);

    await waitFor(() => {
      expect(screen.getByText(/1 spot worth a bite/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("restaurant-card-good-bird")).not.toBeInTheDocument();
    expect(screen.getByTestId("restaurant-card-little-green-bowl")).toBeInTheDocument();
  });
});
