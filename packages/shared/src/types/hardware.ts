export interface CpuData {
  brand: string;
  cores: number;
  physicalCores: number;
  usagePercent: number;
  coreUsage: number[];
  speedGhz: number;
  tempCelsius: number | null;
}

export interface GpuData {
  name: string;
  usagePercent: number;
  vramUsedMb: number;
  vramTotalMb: number;
  tempCelsius: number | null;
  clockMhz: number | null;
}

export interface DiskIo {
  name: string;
  readMBs: number;
  writeMBs: number;
}

export interface DiskUsage {
  mount: string;
  usedGb: number;
  totalGb: number;
  usePercent: number;
}

export interface NetworkIo {
  iface: string;
  uploadMbps: number;
  downloadMbps: number;
}

/** One row in the top-processes panel — grouped by process name. */
export interface ProcessItemData {
  name: string;
  /** Number of OS processes aggregated into this row (e.g. chrome × 14). */
  count: number;
  /** Summed CPU % across instances (can exceed 100 on multi-core). */
  cpuPercent: number;
  /** Summed resident memory across instances. */
  memMb: number;
  memPercent: number;
}

export interface ProcessListData {
  processes: ProcessItemData[];
  fetchedAt: string;
}

export interface HardwareData {
  cpu: CpuData;
  gpu: GpuData | null;
  ram: {
    usedMb: number;
    totalMb: number;
    usagePercent: number;
    swapUsedMb: number;
    swapTotalMb: number;
  };
  disks: DiskIo[];
  diskUsage: DiskUsage[];
  network: NetworkIo[];
  uptime: number;
  battery: { percent: number; charging: boolean } | null;
  fetchedAt: string;
}
