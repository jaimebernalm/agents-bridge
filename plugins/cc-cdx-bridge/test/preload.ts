// Tests never open the developer's browser. A test that checks opening injects its own launcher,
// and spawned bridge servers inherit this setting.
process.env.CC_CDX_PANEL_AUTO_OPEN ??= '0';
