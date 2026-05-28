export const env = {
  language: 'en'
};

export const workspace = {
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue: T): T => defaultValue
  })
};
