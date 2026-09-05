ALTER TABLE "employee_host_operations" ADD COLUMN "computerId" TEXT;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "employee_host_operations") THEN
    RAISE EXCEPTION 'Cannot infer originating computer for existing employee host operations';
  END IF;
END $$;
ALTER TABLE "employee_host_operations" ALTER COLUMN "computerId" SET NOT NULL;
CREATE INDEX "employee_host_operations_computerId_runId_fence_idx" ON "employee_host_operations"("computerId", "runId", "fence");
ALTER TABLE "employee_host_operations" ADD CONSTRAINT "employee_host_operations_computerId_fkey" FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
