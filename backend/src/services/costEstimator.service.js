/**
 * costEstimator.service.js — Educational Resource Cost Estimation.
 *
 * PHASE 7 COST ESTIMATE SPECIFICATION:
 * - This is an approximate educational estimate, NOT an actual cloud bill or provider invoice.
 * - Formula and assumptions:
 *     1. Base running deployment rate (configurable, default $5.00/mo ≈ $0.00685/hr).
 *     2. Dynamic CPU charge based on measured CPU%: (cpuPercent / 100) * ESTIMATED_CPU_HOURLY_RATE.
 *     3. Dynamic RAM charge based on measured RAM in GB: (memoryUsedMb / 1024) * ESTIMATED_RAM_GB_HOURLY_RATE.
 *     4. Stopped or deleted containers are charged $0.00/hr.
 *     5. If COST_ESTIMATE_ENABLED is false, returns disabled status.
 */

const getCostModelConfig = () => {
  const enabled = process.env.COST_ESTIMATE_ENABLED === 'true';
  const monthlyBase = parseFloat(process.env.ESTIMATED_MONTHLY_DEPLOYMENT_COST || '5.00');
  const cpuHourlyRate = parseFloat(process.env.ESTIMATED_CPU_HOURLY_RATE || '0.005');
  const ramGbHourlyRate = parseFloat(process.env.ESTIMATED_RAM_GB_HOURLY_RATE || '0.005');

  return {
    enabled,
    monthlyBase: isNaN(monthlyBase) ? 5.00 : monthlyBase,
    cpuHourlyRate: isNaN(cpuHourlyRate) ? 0.005 : cpuHourlyRate,
    ramGbHourlyRate: isNaN(ramGbHourlyRate) ? 0.005 : ramGbHourlyRate,
  };
};

/**
 * Calculate estimated cost for a given container measurement.
 *
 * @param {Object} params
 * @param {boolean} params.isRunning - whether the container is currently running
 * @param {number}  params.cpuPercent - measured CPU % (e.g. 12.5)
 * @param {number}  params.memoryUsedMb - measured Memory in MB (e.g. 256)
 * @returns {Object} Cost estimation details
 */
const calculateEstimatedCost = ({ isRunning = false, cpuPercent = 0, memoryUsedMb = 0 } = {}) => {
  const config = getCostModelConfig();

  if (!config.enabled) {
    return {
      enabled: false,
      isConfigured: false,
      message: 'Cost estimate not configured',
      disclaimer: 'This is an approximate estimate, not an actual cloud bill.',
    };
  }

  // If container is not running, cost is $0.00
  if (!isRunning) {
    return {
      enabled: true,
      isConfigured: true,
      isRunning: false,
      hourlyUsd: 0.0,
      dailyUsd: 0.0,
      monthlyUsd: 0.0,
      currency: 'USD',
      isSimulated: true,
      disclaimer: 'This is an approximate estimate, not an actual cloud bill.',
      breakdown: {
        baseHourly: 0.0,
        cpuHourly: 0.0,
        ramHourly: 0.0,
      },
    };
  }

  // Base rate (730 average hours per month)
  const baseHourly = config.monthlyBase / 730;

  // Safe CPU & RAM calculation
  const safeCpuPercent = Math.max(0, Math.min(cpuPercent || 0, 1000));
  const safeMemoryMb = Math.max(0, memoryUsedMb || 0);

  const cpuHourly = (safeCpuPercent / 100) * config.cpuHourlyRate;
  const ramHourly = (safeMemoryMb / 1024) * config.ramGbHourlyRate;

  const totalHourly = baseHourly + cpuHourly + ramHourly;
  const totalDaily = totalHourly * 24;
  const totalMonthly = totalHourly * 730;

  return {
    enabled: true,
    isConfigured: true,
    isRunning: true,
    hourlyUsd: Number(totalHourly.toFixed(6)),
    dailyUsd: Number(totalDaily.toFixed(4)),
    monthlyUsd: Number(totalMonthly.toFixed(2)),
    currency: 'USD',
    isSimulated: true,
    disclaimer: 'This is an approximate estimate, not an actual cloud bill.',
    breakdown: {
      baseMonthly: config.monthlyBase,
      baseHourly: Number(baseHourly.toFixed(6)),
      cpuHourly: Number(cpuHourly.toFixed(6)),
      ramHourly: Number(ramHourly.toFixed(6)),
      formula: `Base ($${config.monthlyBase.toFixed(2)}/mo) + ($${config.cpuHourlyRate}/vCPU-hr * CPU%) + ($${config.ramGbHourlyRate}/GB-hr * RAM)`,
    },
  };
};

module.exports = {
  getCostModelConfig,
  calculateEstimatedCost,
};
