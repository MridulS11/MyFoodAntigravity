"use client";

import { useQuery } from "@tanstack/react-query";
import { formatOrderDate } from "@/lib/format";
import { services } from "@/services";

export default function AdminAuditLogsPage() {
  const { data: logs = [], isError, error } = useQuery({
    queryKey: ["adminAuditLogs"],
    queryFn: () => services.adminPortal.listAuditLogs(),
  });

  if (isError) {
    return (
      <div className="bg-white border border-[#FAC8C3] rounded-2xl p-6 text-sm text-[#C62828]">
        {error instanceof Error ? error.message : "Permission audit_logs:view required."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F8E63]">
          SECURITY &amp; GOVERNANCE
        </div>
        <h1 className="text-2xl font-extrabold text-[#1E1F1C] mt-1">
          Administrative audit logs
        </h1>
      </div>

      <div className="bg-white border border-[#E8E3D5] rounded-2xl divide-y divide-[#E8E3D5]">
        {logs.map((log) => (
          <div key={log.id} className="p-4 text-xs space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-extrabold text-[#1E1F1C]">
                {log.action}
              </span>
              <span className="text-[#8A8880]">
                {formatOrderDate(log.createdAt)}
              </span>
            </div>
            <div className="text-[#5E5D57]">
              Actor: <strong>{log.adminName}</strong> ({log.adminRole}) ·
              Permission: <code>{log.permissionUsed}</code> · Target:{" "}
              <code>
                {log.targetEntityType}:{log.targetEntityId}
              </code>
            </div>
            {log.reason && (
              <div className="text-[#1E1F1C]">Reason: {log.reason}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
