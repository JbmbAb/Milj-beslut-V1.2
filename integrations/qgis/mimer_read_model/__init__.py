def classFactory(iface):
    from .mimer_plugin import MimerReadModelPlugin

    return MimerReadModelPlugin(iface)
