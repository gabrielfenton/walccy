module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Strip console calls from production builds (release APK).
      // Dev builds keep them for debugging.
      ...(process.env.NODE_ENV === 'production'
        ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
        : []),
      // react-native-reanimated/plugin (the worklets plugin) MUST be the
      // last entry — it needs to run over the fully-transformed code.
      'react-native-reanimated/plugin',
    ],
  };
};
