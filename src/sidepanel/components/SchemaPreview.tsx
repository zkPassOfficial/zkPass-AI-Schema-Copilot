import { JsonView, darkStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import type { ZkPassSchema } from "@/shared/types";
import { validateSchema } from "@/schema/validator";

interface SchemaPreviewProps {
  schema: ZkPassSchema;
}

export default function SchemaPreview({ schema }: SchemaPreviewProps) {
  const validation = validateSchema(schema);

  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-lg border border-[#d8dec9] bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-[#d8dec9] px-3 py-2">
        <span className="text-xs font-semibold text-[#272727]">Generated Schema</span>
        {validation.valid ? (
          <span className="rounded-full bg-[#f4ffd8] px-2 py-0.5 text-xs font-medium text-[#456000] ring-1 ring-[#c5ff4a]/60">
            Valid
          </span>
        ) : (
          <span className="text-xs font-medium text-red-600">{validation.errors.length} issue(s)</span>
        )}
      </div>
      <div className="max-h-64 overflow-auto bg-[#3d3d3d] p-2 text-xs">
        <JsonView data={schema} style={darkStyles} />
      </div>
      {!validation.valid && (
        <div className="border-t border-[#d8dec9] bg-red-50 px-3 py-2">
          {validation.errors.map((err, i) => (
            <div key={i} className="text-xs text-red-600">
              {err}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
