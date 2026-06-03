const parseBoolean = (value) =>
  ["1", "true", "yes", "on"].includes(value?.toString().trim().toLowerCase());

export const isDeviceBlockingEnabled = () =>
  parseBoolean(process.env.DEVICE_BLOCKING_ENABLED);

