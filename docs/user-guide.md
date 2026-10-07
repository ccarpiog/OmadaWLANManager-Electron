# Omada WLAN Manager — user guide

Omada WLAN Manager moves TP-Link Omada access points between AP groups. On Omada Controller 6.3
or later, optional **management access** also lets it create, rename and delete AP groups and
create, edit, enable, disable and delete Wi-Fi networks, and choose which AP groups broadcast each
network. With an optional TP-Link cloud account it also reaches controllers that are not on your
network (section 9).

The app's interface is in Spanish or English (choose it in Settings). This guide is in English and
gives every interface term in both languages: in the table below, and in the text as bold
English / Spanish pairs, such as **Settings** / **Ajustes**.

## UI terms

| English UI | Spanish UI |
|---|---|
| Access points | Puntos de acceso |
| AP groups | Grupos de AP |
| WLAN groups (legacy) | Grupos WLAN (heredado) |
| Wi-Fi networks | Redes Wi-Fi |
| Settings | Ajustes |
| Configure connection | Configurar la conexión |
| Connect | Conectar |
| Disconnect | Desconectar |
| Refresh | Actualizar |
| Retry | Reintentar |
| Move selected APs | Mover los AP seleccionados |
| Silence | Silenciar |
| No Wi-Fi networks — silences these APs | Sin redes Wi-Fi — silencia estos AP |
| Move AP | Mover AP |
| Move 4 APs | Mover 4 AP |
| Review the move | Revisar el movimiento |
| Retry failed | Reintentar los fallidos |
| Management access (optional) | Acceso de gestión (opcional) |
| Test management access | Probar el acceso de gestión |
| New group | Nuevo grupo |
| Rename | Cambiar nombre |
| Delete | Eliminar |
| Move access points here | Mover puntos de acceso aquí |
| Per-band capacity | Capacidad por banda |
| Capacity warning | Aviso de capacidad |
| Default | Predeterminado |
| New network | Nueva red |
| Edit | Editar |
| Change password | Cambiar contraseña |
| Enable | Activar |
| Disable | Desactivar |
| Broadcast on | Se emite en |
| Change AP groups | Cambiar grupos de AP |
| All access points | Todos los puntos de acceso |
| Unknown scope | Alcance desconocido |
| Trust and connect | Confiar y conectar |
| Reset trusted certificate | Restablecer certificado de confianza |
| TP-Link cloud (optional) | Nube de TP-Link (opcional) |
| Test cloud access | Probar el acceso a la nube |
| Remove cloud access | Quitar el acceso a la nube |
| Controller | Controlador |
| This network | Esta red |
| Cloud | Nube |
| Connect through TP-Link cloud | Conectar a través de la nube de TP-Link |
| Choose controller | Elegir controlador |

## 1. Connecting

1. Open **Settings** / **Ajustes** (the gear at the bottom of the sidebar), or click
   **Configure connection** / **Configurar la conexión** on the first launch.
2. Fill in **Controller URL** / **URL del controlador** (for example `https://192.168.1.1:8043`),
   **Username** / **Usuario** and **Password** / **Contraseña**, pick the **Language** / **Idioma**,
   and click **Save** / **Guardar**. Nothing is saved before that.
3. Click **Connect** / **Conectar** in the header. The first time, the app asks you to confirm the
   controller's certificate (see [Certificate trust](#8-certificate-trust)). If the controller has
   several sites, choose one in **Select site** / **Seleccionar sitio**.
4. The header shows the site, the controller, the connection state, the time of the last load
   (**Updated 10:42** / **Actualizado 10:42**) and the Omada version. **Refresh** / **Actualizar**
   reloads everything and keeps the current data on screen meanwhile. If a refresh fails, the old
   data stays with the notice **Couldn't refresh the data. Showing the data from 10:42.** /
   **No se pudieron actualizar los datos. Se muestran los de las 10:42.** and a
   **Retry** / **Reintentar** button.

Credentials belong to one controller URL: saving a different URL drops the stored password, the
management credentials, the chosen site and the trusted certificate, and asks for the new
controller's password. The optional TP-Link cloud credential is not tied to it, and with one you can
also leave the controller fields empty and use cloud controllers only (section 9).

## 2. The three views

The sidebar switches between three views; each count is a total, not a filtered count. While a
TP-Link cloud credential is saved, the controller switcher sits above them (section 9).

- **Access points** / **Puntos de acceso** — the landing view: select access points and move them.
- **AP groups** / **Grupos de AP** (on controllers older than 6.3: **WLAN groups (legacy)** /
  **Grupos WLAN (heredado)**) — each group with its access points and Wi-Fi networks, including
  groups without any network.
- **Wi-Fi networks** / **Redes Wi-Fi** — each network with the groups and access points that
  broadcast it.

Every view has its own search. Clicking a group, network or access point name anywhere opens it in
its own view; **Back to …** / **Volver a …** returns to where you were. Without management access
the AP groups and Wi-Fi networks views are read-only, and a banner says why (section 4).

The window adapts to its width (minimum 700×500): from 1000 px the sidebar shows labels, from
800 px only icons and counts, and below 800 px a bar at the top switches views and each view shows
one pane at a time, with **←** back to the list.

## 3. Selecting and moving access points

- Tick the checkbox of each access point to move. Shift-click or Shift+arrow keys select a range;
  **Select all 12 filtered APs** / **Seleccionar los 12 AP filtrados** ticks every access point the
  search and filters show, and **Clear selection** / **Borrar selección** unticks all. A selection
  survives searching and filtering: the summary under the list says, for example,
  **2 hidden by filters** / **2 ocultos por los filtros**.
- Pick the destination in **Move selected APs** / **Mover los AP seleccionados**, next to the list
  (below 800 px, **Choose destination** / **Elegir destino** opens it). Its search
  (**Search groups or networks…** / **Buscar grupos o redes…**) matches group names and network
  names. Groups without networks are listed under **Silence** / **Silenciar** with the label
  **No Wi-Fi networks — silences these APs** / **Sin redes Wi-Fi — silencia estos AP**: moving an
  access point there stops it broadcasting.
- The pane previews the networks the selected access points gain, lose and keep (**Gains** /
  **Gana**, **Loses** / **Pierde**, **Unchanged** / **Sin cambios**) and how many are already in the
  destination (they are skipped). Access points report only their group's name, so a group whose
  name another group shares cannot be picked:
  **Another group has the same name — rename one in Omada to move APs here** /
  **Otro grupo tiene el mismo nombre — cambia el nombre de uno en Omada para mover AP aquí**.
- Click **Move AP** / **Mover AP** (or **Move 4 APs** / **Mover 4 AP**). **Review the move** /
  **Revisar el movimiento** lists the source groups, the destination, the network changes and the
  clients connected to the moving access points. It opens on **Cancel** / **Cancelar**; press the
  move button to confirm.
- Access points move one at a time; the move is not atomic. **Move results** /
  **Resultado del movimiento** lists each one as **Moved** / **Movido** or **Failed** / **Error**
  with the controller's message. Failed access points stay selected, and **Retry failed** /
  **Reintentar los fallidos** moves only those, through the same review.
- Click an access point's row (not its checkbox), or press Enter on its checkbox, to open
  **AP details** / **Detalles del AP**: status, MAC, group, clients and its group's networks.
  Per-AP network overrides set in Omada are not shown. **Close details** / **Cerrar detalles**
  brings the move pane back.

Moving access points never needs management access; it works on every controller version.

## 4. Management access (optional)

Management access uses the controller's Open API. It needs Omada Controller 6.3 or later and an
Open API application:

1. In the Omada web interface, open *Global View → Settings → Platform Integration → Open API* and
   add an application in **client credentials** mode with access to the site you manage. Copy its
   Client ID and Client Secret.
2. In the app, open **Settings** / **Ajustes**, section **Management access (optional)** /
   **Acceso de gestión (opcional)**. Fill in **Client ID** / **Client ID** and **Client Secret** /
   **Client Secret** and click **Save** / **Guardar**. The secret is never shown again: the field
   then reads **(unchanged)** / **(sin cambios)**, and leaving it blank keeps it. It is stored
   encrypted only when the computer can store it securely (the macOS Keychain, DPAPI on Windows, a
   secret service such as GNOME Keyring or KWallet on Linux). Otherwise it is never written to disk:
   it is kept only until you quit the app, and Settings says so:
   **This computer cannot store the Client Secret securely: it is kept only until you quit the app, and you will need to enter it again next time.** /
   **Este equipo no puede guardar el Client Secret de forma segura: solo se conserva hasta que cierres la aplicación y tendrás que volver a introducirlo la próxima vez.**
3. While connected, click **Test management access** / **Probar el acceso de gestión** (save first:
   the test uses the saved settings). It checks, in order, the controller version, the credentials,
   an access token, that the Open API sees the connected site, and that it reports exactly the same
   AP groups (by id) as the controller. Success reads **Management access works: every check passed.** /
   **El acceso de gestión funciona: se superaron todas las comprobaciones.**; otherwise the line names
   the failed check, with technical codes in parentheses.
4. **Remove management access** / **Quitar el acceso de gestión** deletes both values when you save;
   **Keep management access** / **Mantener el acceso de gestión** undoes it before saving.

**Read-only banner.** Without working management access, the AP groups and Wi-Fi networks views show
a banner with the reason and the fix, for example
**Open API credentials are not configured — viewing is available. Add them in Settings → Management access.** /
**No hay credenciales de Open API configuradas — puedes consultar los datos. Añádelas en Ajustes → Acceso de gestión.**
The possible reasons:

| Reason | What to do |
|---|---|
| The controller is older than 6.3 (legacy) | Nothing: moving access points works; editing needs 6.3 or later. |
| No Client ID / Client Secret saved | Add them in Settings. |
| The check is still running (also during a new test) | Wait: **Checking management access — viewing is available meanwhile.** / **Comprobando el acceso de gestión — mientras tanto puedes consultar los datos.** |
| The controller rejected the Client ID or Client Secret | Check both values in Settings. |
| No access token | Check that the Open API is enabled; run the test for details. |
| The Open API application cannot see this site | Give the application access to the site in Omada. |
| The Open API shows different AP groups than the controller | Management stays off for safety; report it (see the live-test checklist). |
| The Open API did not answer the checks | Run the test again; check the controller. |

Management actions appear only once every check passes. While a check runs, they are hidden.

## 5. AP groups

The list shows each group's access-point count and network count, the **Default** /
**Predeterminado** badge for the controller's default group, the label **No Wi-Fi networks —
silences these APs** / **Sin redes Wi-Fi — silencia estos AP** for groups without networks, and,
with management access, **Capacity warning** / **Aviso de capacidad** when the controller reports
a band of the group full (its tooltip names the band). A group's details list its access points
and its networks (as links; networks are bound to groups in the Wi-Fi networks view, section 7).

With management access, the details also show **Per-band capacity** / **Capacidad por banda**: how
many more networks the group can broadcast on 2.4 GHz, 5 GHz, 6 GHz and MLO, such as
**3 of 8 free** / **3 libres de 8**, or **Not reported** / **No informado** when the controller
does not say. The app never guesses a value.

Actions (management access only):

- **New group** / **Nuevo grupo** opens **New AP group** / **Nuevo grupo de AP**: type the
  **Group name** / **Nombre del grupo** and click **Create group** / **Crear grupo**. The group is
  created empty; move access points into it afterwards. A name has 1 to 128 characters, differs
  from every other group's name (ignoring case) and has no control characters.
- **Rename** / **Cambiar nombre** opens **Rename the group** / **Cambiar el nombre del grupo**. Its
  access points and networks stay as they are.
- **Delete** / **Eliminar** opens **Delete the group** / **Eliminar el grupo**; confirm with
  **Delete group** / **Eliminar grupo**. It cannot be undone. The default group has no Delete. For
  other groups the button is disabled, with the reason under it, until the group can go:
  - **To delete it, first move its access points to another group.** /
    **Para eliminarlo, mueve antes sus puntos de acceso a otro grupo.**
  - **To delete it, first unlink its Wi-Fi networks.** /
    **Para eliminarlo, desvincula antes sus redes Wi-Fi.**
  - **It cannot be deleted: the controller does not clearly report its access points or networks.** /
    **No se puede eliminar: el controlador no informa con claridad de sus puntos de acceso o de sus redes.**
  - **Checking whether it can be deleted…** / **Comprobando si se puede eliminar…**
- A group whose id the app does not recognize gets a note instead of the buttons:
  **This group's id has an unexpected format, so the app cannot rename or delete it.** /
  **El identificador de este grupo tiene un formato inesperado: la aplicación no puede cambiarle el nombre ni eliminarlo.**
- **Move access points here** / **Mover puntos de acceso aquí** (always available) opens
  Access points with this group already picked as the destination; tick the access points and move
  them as in section 3.

Before every change the app reads the controller's current groups again and refuses (with the
reason) when they contradict what you saw, for example when another group took the name meanwhile.

## 6. Wi-Fi networks

Without management access, the view lists the network names from the controller's group data, with
the groups and access points that broadcast each one; **Security, bands and whether the network is
enabled are not shown: they need management access.** / **No se muestran la seguridad, las bandas ni
si la red está activada: requieren acceso de gestión.**

With management access, each network shows its state (**Enabled** / **Activada** or **Disabled** /
**Desactivada**), its security (**Open** / **Abierta**, **WPA-Personal** / **WPA-Personal**,
**WPA-Enterprise** / **WPA-Enterprise**, **PPSK without RADIUS** / **PPSK sin RADIUS**,
**PPSK with RADIUS** / **PPSK con RADIUS**), its bands and its scope: **All access points** /
**Todos los puntos de acceso**, a count such as "2 groups · 7 APs", or **Unknown scope** /
**Alcance desconocido** when the controller does not say clearly. A network's details add whether a
password is set (**Set** / **Configurada**), never the password itself. If the list cannot be read
completely, the view shows why with **Retry** / **Reintentar** instead of a partial list.

Actions (management access only; each one asks for confirmation and names the scope it affects):

- **New network** / **Nueva red** opens **New Wi-Fi network** / **Nueva red Wi-Fi**: the
  **Network name (SSID)** / **Nombre de la red (SSID)** (1 to 32 bytes; accented letters and emoji
  take more than one), the **Security** / **Seguridad** (Open or WPA-Personal), the **Bands** /
  **Bandas**, for WPA-Personal the **Network password** / **Contraseña de la red** and
  **Type the password again** / **Repite la contraseña** (8 to 63 printable ASCII characters, used
  exactly as typed), at least one of the **AP groups that broadcast it** / **Grupos de AP que la
  emiten**, and **Enable after creating** / **Activar después de crearla** (off by default). Click
  **Create network** / **Crear red**. The network is created disabled unless that box is ticked. An
  open network cannot be created with 6 GHz: create it without, then add 6 GHz with Edit.
- **Edit** / **Editar** changes the name, Open ↔ WPA-Personal and the bands. Nothing is sent until
  **Review changes** / **Revisar los cambios** shows the differences and you click
  **Save changes** / **Guardar cambios** (or **Back** / **Atrás** to keep editing). Saving a
  WPA-Personal network always asks for its password again, because the app never reads the current
  one from the controller. A band or security change can lower the network's PMF setting from
  "Mandatory" to "Capable"; the review warns about it.
- **Change password** / **Cambiar contraseña**: type the new password twice, then confirm in
  **Confirm the password change** / **Confirmar el cambio de contraseña**. Devices must use the new
  password to join again.
- **Enable** / **Activar** and **Disable** / **Desactivar** start or stop broadcasting the network
  on its whole scope (confirm with **Enable network** / **Activar red** or **Disable network** /
  **Desactivar red**). Disabling disconnects its clients.
- **Delete** / **Eliminar** opens **Delete the network** / **Eliminar la red**, which lists the AP
  groups that will stop broadcasting it; **Delete network** / **Eliminar red** cannot be undone.

**WPA-Enterprise and PPSK networks** can be viewed, enabled, disabled, deleted and bound to AP
groups, but not edited and without Change password; their details explain why. Use the Omada web
interface for their settings. Nor can a network whose security the controller does not report
clearly be edited here.

The actions wait for fresh data: while the data on screen is stale (its last refresh failed) or the
network list is being read again, they are disabled with the reason. The app reads the network again
right before the Change password, Enable, Disable and Delete confirmations, and an edit is merged into
the controller's current settings when you save it.

## 7. Broadcast on

A managed network's details have a **Broadcast on** / **Se emite en** section with the AP groups
that broadcast it. This is the only place where the app changes which groups broadcast a network.

1. Click **Change AP groups** / **Cambiar grupos de AP**. Tick and untick groups; the search
   (**Search AP groups…** / **Buscar grupos de AP…**) filters the list, and a preview shows how
   many groups and access points will broadcast the network.
2. Click **Review the change** / **Revisar el cambio**. The app first reads the current data again
   (**Reading the current data again…** / **Leyendo de nuevo los datos actuales…**), then lists the
   groups **Now** / **Ahora** and **After** / **Después**, and which are **Added** / **Se añaden**,
   **Removed** / **Se quitan** and **Kept** / **Se mantienen**.
3. Groups without room for the network on one of its bands are listed under
   **No confirmed room for this network:** / **Sin hueco confirmado para esta red:** with the band;
   the app never assumes there is room, so it does not save such a change.
4. Click **Save AP groups** / **Guardar grupos de AP**. The access points of removed groups stop
   broadcasting the network and their clients on it are disconnected.

Rules: a network keeps at least one group (to stop broadcasting it, disable it). A network on
**All access points** / **Todos los puntos de acceso** stays read-only here (the app never turns it
into a list of groups; change it in the Omada web interface), and so does a network with
**Unknown scope** / **Alcance desconocido**. For a network that uses MLO, adding groups is refused
until the controller reports the groups' MLO room; removing groups still works.

## 8. Certificate trust

Omada controllers use self-signed certificates, so the app trusts a controller's certificate on
first use and pins it:

- On the first connection, **Verify the controller certificate** / **Verificar el certificado del
  controlador** shows the controller and the certificate's SHA-256 fingerprint. Compare it with the
  controller's certificate, then click **Trust and connect** / **Confiar y conectar**. No password
  is sent before you do.
- If the controller later presents another certificate, **Controller certificate changed** /
  **El certificado del controlador ha cambiado** shows both fingerprints and the app does not
  connect. If you expected the change (for example, the controller's certificate was regenerated),
  open **Settings** / **Ajustes**, click **Reset trusted certificate** / **Restablecer certificado
  de confianza**, confirm with **Reset** / **Restablecer**, and connect again.
- Settings shows the pinned fingerprint under **Trusted certificate (SHA-256)** /
  **Certificado de confianza (SHA-256)**.
- TP-Link cloud controllers (section 9) are reached through TP-Link's servers, whose certificates are
  verified normally: no dialog, no pinning. While a cloud credential is saved, Settings says so:
  **TP-Link cloud controllers are reached through TP-Link's cloud: their certificate is verified normally, with no pinning and no prompt.** /
  **Los controladores de la nube de TP-Link se alcanzan a través de la nube de TP-Link: su certificado se verifica de la forma habitual, sin fijarlo ni preguntar.**

## 9. TP-Link cloud controllers (optional)

With a TP-Link cloud account, the app can also reach Omada controllers that are not on your network
(for example OC200 controllers at another site) through TP-Link's cloud, beside the controller it
connects to directly. It uses TP-Link's Account Level Open API (beta). Like management access, it was
built against the documentation and has not been verified live yet.

1. In TP-Link's Omada cloud portal, open *On Premise Systems → Open API* and create a credential in
   **client credentials** mode: choose its validity, the controllers it may reach and its access
   (changes need **full access**; with view-only access the app can only show data). If the page is
   missing, TP-Link has not enabled it for your account yet.
2. In **Settings** / **Ajustes**, section **TP-Link cloud (optional)** /
   **Nube de TP-Link (opcional)**, pick the **Region** / **Región** of your account (the default is
   **Europe (EUW)** / **Europa (EUW)**), fill in **Client ID** / **Client ID** and
   **Client Secret** / **Client Secret**, and click **Save** / **Guardar**. The secret is never
   shown again; a new region or Client ID needs it again
   (**(required for the new region)** / **(obligatorio para la nueva región)**). As with the
   management Client Secret (section 4), it is stored encrypted only when the computer can store it
   securely; otherwise it is never written to disk but kept only until you quit the app, and
   Settings says so:
   **This computer cannot store the cloud Client Secret securely: it is kept only until you quit the app, and you will need to enter it again next time.** /
   **Este equipo no puede guardar el Client Secret de la nube de forma segura: solo se conserva hasta que cierres la aplicación y tendrás que volver a introducirlo la próxima vez.**
3. **Test cloud access** / **Probar el acceso a la nube** (save first; no connection is needed)
   lists the account's controllers, for example
   **Cloud access works: 3 controllers found.** /
   **El acceso a la nube funciona: se encontraron 3 controladores.**, each with its version and
   **Available** / **Disponible** or the reason it cannot be used, and marks your local controller's
   own entry **This network** / **Esta red**. A failed test names the problem, for example
   **TP-Link says this credential has expired or no longer exists. Create a new one in the TP-Link Omada cloud portal and save it here.** /
   **TP-Link indica que esta credencial ha caducado o ya no existe. Crea otra en el portal de Omada en la nube de TP-Link y guárdala aquí.**
4. **Remove cloud access** / **Quitar el acceso a la nube** deletes the region, the Client ID and
   the Client Secret when you save; **Keep cloud access** / **Mantener el acceso a la nube** undoes
   it before saving.

**The controller switcher.** While a cloud credential is saved, the top of the sidebar shows
**Controller** / **Controlador** and the controller in use. Click it (or press Enter on it) to list
**This network** / **Esta red** (the controller on your network, with its address) and then the
cloud controllers by name, each with the **Cloud** / **Nube** tag and its version. Your local
controller's own cloud entry is not listed a second time. A controller that cannot be used is listed
but disabled, with the reason under it, such as
**Offline: the controller is not online in the TP-Link cloud.** /
**Sin conexión: el controlador no está en línea en la nube de TP-Link.** or
**Cannot be used: it runs a version older than Omada 6.3.** /
**No se puede usar: es anterior a Omada 6.3.** While a move, a group or network change, a
connection or a settings save is running, the switcher is disabled:
**Wait for the current operation to finish before switching controllers.** /
**Espera a que termine la operación en curso para cambiar de controlador.** The list is read when
the app starts and after each settings save.

Choosing a controller clears what is on screen (selection, destination, filters, searches, details,
Back history), connects to it and loads its data; the header shows its name. The app remembers the
choice and starts on it next time, and each cloud controller remembers its site.

**When the local controller does not answer** (you are away from its network, for example) and the
cloud lists it online, the error shows **Connect through TP-Link cloud** /
**Conectar a través de la nube de TP-Link** beside **Retry** / **Reintentar** and **Settings** /
**Ajustes**. It reaches the same controller through the cloud, and **This network** /
**Esta red** then carries the **Cloud** / **Nube** tag; choose **This network** / **Esta red**
again to connect directly once you are back.

**Without a local controller,** leave **Controller URL** / **URL del controlador**, **Username** /
**Usuario** and **Password** / **Contraseña** empty and fill in only the cloud section (management
access belongs to a controller on your network, so it is refused there). The views then show
**Choose a TP-Link cloud controller to get started** /
**Elige un controlador de la nube de TP-Link para empezar** with **Choose controller** /
**Elegir controlador**, which opens the switcher; your controllers are all listed, with no
**This network** / **Esta red**.

**Removing cloud access** while a cloud controller is in use takes the app back to the local
controller, or, without one, to the first launch's **Configure connection** /
**Configurar la conexión**.

**On a cloud controller** the app uses the Open API only:

- What TP-Link does not report reads as unknown, such as **Unknown status** /
  **Estado desconocido**, **Unknown group** / **Grupo desconocido** or **Networks unknown** /
  **Redes desconocidas**; the app never guesses.
- An access point counts as **Moved** / **Movido** only once the controller lists it in the new group
  (the app reads the list again up to three times); otherwise it is **Failed** / **Error** with the
  reason, and **Retry failed** / **Reintentar los fallidos** works as usual.
- Management uses the cloud credential, not **Management access (optional)** /
  **Acceso de gestión (opcional)**: it is on when TP-Link accepts the credential and lists the site.
  Changes need full access; a view-only credential's refusals show TP-Link's code and message.
- The controller must run Omada 6.3 or later and be online in the TP-Link cloud.
- TP-Link accepts at most 10 requests per second for a credential; the app sends at most 5 and waits
  when TP-Link asks it to, so a cloud controller is slower than a direct one. When TP-Link refuses
  anyway, the app says
  **TP-Link is receiving too many requests for this credential (rate limit). Wait a moment and try again.** /
  **TP-Link está recibiendo demasiadas solicitudes con esta credencial (límite de frecuencia). Espera un momento y vuelve a intentarlo.**
- Their certificates are verified normally (see section 8).

## 10. Keyboard shortcuts

| Keys | Action |
|---|---|
| `Cmd+F` (macOS) / `Ctrl+F` | Focus the current view's search (not while a dialog is open). |
| `Escape` | Clear the current search; otherwise close the open dialog, as Cancel does (in Settings it first cancels an open confirmation). |
| Arrow keys, `Home`, `End` | Move through lists, including the lists inside dialogs. |
| `Space` | Tick or untick the focused checkbox. |
| Shift-click, `Shift` + arrow keys | Select a range of access points. |
| `Enter` on an access point's checkbox | Open its details. |
| `Enter` on a destination | Review the move to it. |
| `Enter` on the controller switcher | Open its list; arrow keys, `Home` and `End` move through it, `Escape` closes it. |

Destructive confirmations always open on Cancel, never on the destructive button.

## 11. Good to know

- The app never invents a value: what the controller does not report clearly reads as unknown, and
  the actions that would depend on it are refused with the reason.
- Moves use the controller's internal API (the same call the Omada web interface makes); management
  uses the Open API. On a TP-Link cloud controller both use the Open API (section 9). The management
  features and the TP-Link cloud access were built against the documented APIs and tested on
  fixtures; they have not been verified live yet (that is the manual
  [live-test checklist](live-test-checklist.md), with Part C for the cloud, not run so far).
- Configuration lives in `~/.omada-wlan-manager/config.json`. The password is stored encrypted (in
  plain text only when the system offers no encryption at all). Both Client Secrets (management and
  TP-Link cloud) are stored encrypted only when the computer can store them securely; otherwise they
  are never written to disk and are kept only until you quit the app (see the README).
