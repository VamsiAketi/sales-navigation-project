import { describe, expect, it, vi } from "vitest";
import {
  cancelMaintenanceRequestForHeartbeatRun,
  reconcileMaintenanceRequestForFinishedRun,
} from "../services/project-maintenance-queue.js";

describe("project-maintenance-queue", () => {
  it("marks in-progress maintenance cancelled when heartbeat run is cancelled", async () => {
    const update = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "req-1", projectId: "proj-1" }]),
      }),
    });
    const db = {
      update: vi.fn().mockReturnValue({ set: update }),
    } as unknown as Parameters<typeof cancelMaintenanceRequestForHeartbeatRun>[0];

    const rows = await cancelMaintenanceRequestForHeartbeatRun(db, "run-1", "Cancelled by operator");
    expect(rows).toHaveLength(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        heartbeatRunId: null,
      }),
    );
  });

  it("does not re-queue maintenance when linked run was cancelled", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            {
              id: "req-1",
              projectId: "proj-1",
              status: "in_progress",
              heartbeatRunId: "run-1",
            },
          ]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: updateWhere }),
      }),
    } as unknown as Parameters<typeof reconcileMaintenanceRequestForFinishedRun>[0];

    const result = await reconcileMaintenanceRequestForFinishedRun(
      db,
      "run-1",
      "cancelled",
      "Cancelled by operator",
    );

    expect(result).toEqual({ requestId: "req-1", projectId: "proj-1", action: "cancelled" });
    expect(updateWhere).toHaveBeenCalled();
  });
});
