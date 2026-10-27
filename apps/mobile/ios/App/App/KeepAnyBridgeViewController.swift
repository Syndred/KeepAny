import UIKit
import Capacitor
import KeepAnyMetadata
import KeepAnyIdentity
import KeepAnyConnections
import KeepAnyMcpAuthority

final class KeepAnyBridgeViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        guard let webView = webView else { return }
        // A native container owns the status/home-indicator exclusion, including
        // the first frame before WebKit has calculated CSS safe-area values.
        let container = UIView(frame: view.bounds)
        container.backgroundColor = UIColor(red: 1, green: 0.976, blue: 0.925, alpha: 1)
        view = container
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: container.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: container.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.safeAreaLayoutGuide.trailingAnchor)
        ])
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(KeepAnyMetadataPlugin())
        bridge?.registerPluginInstance(KeepAnyIdentityPlugin())
        bridge?.registerPluginInstance(KeepAnyConnectionsPlugin())
        bridge?.registerPluginInstance(KeepAnyMcpAuthorityPlugin())
    }
}
