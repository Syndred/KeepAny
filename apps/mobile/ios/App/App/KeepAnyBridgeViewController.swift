import Capacitor
import KeepAnyMetadata
import KeepAnyIdentity

final class KeepAnyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(KeepAnyMetadataPlugin())
        bridge?.registerPluginInstance(KeepAnyIdentityPlugin())
    }
}
