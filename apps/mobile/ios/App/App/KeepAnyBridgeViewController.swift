import Capacitor
import KeepAnyMetadata

final class KeepAnyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(KeepAnyMetadataPlugin())
    }
}
