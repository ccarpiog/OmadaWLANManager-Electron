# Omada Open API — AP Group & SSID operations (extracted from controller 6.3.0.45 spec)

## GET /openapi/v1/{omadacId}/sites/{siteId}/ap-groups

**Get AP Group list** — Get AP Group list<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager View Only<br/>Network Config Page View Only<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.

Parameters:
- page (query, required): integer — Start page number. Start from 1.
- pageSize (query, required): integer — Number of entries per page. It should be within the range of 1–1000.
- searchKey (query): string — Fuzzy query parameters, support field name

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - totalRows: integer — Total rows of all items.
  - currentPage: integer — Current page number.
  - currentSize: integer — Number of entries per page.
  - data: array<ApGroupOpenApiVO>
    - id: string — AP group ID
    - name: string — ap group name should contain 1 to 128 characters.
    - primary: boolean — Whether it is the default ap group
    - apNum: integer — Number of APs in this group
    - remainingBinding: object — Number of SSID remaining bindings for this group, 0:2g, 1:5g, 2:6g
    - ssidNameList: array<string> — SSID name list bound to this group
  - maxSsids2G: integer — 2G radio max Ssid number in group
  - maxSsids5G: integer — 5G radio max Ssid number in group
  - maxSsids6G: integer — 6G radio max Ssid number in group
  - maxSsidsMlo: integer — max Mlo Ssid number in group
```

## POST /openapi/v1/{omadacId}/sites/{siteId}/ap-groups

**Create new AP Group** — Create new AP Group<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager Modify<br/>Network Config Page Modify<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.<br/>-33200 - This WLAN group has been already created.<br/>-33201 - The number of WLAN groups has reached the limit.<br/>-33202 - This WLAN group is not in the same site.

Request body (* = required):
```
- name*: string — AP group name should contain 1 to 128 characters.
- apMacs: array<string> — List of AP device MAC addresses bound to this AP group. Can be empty.
```

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - id: string — AP Group ID
```

## GET /openapi/v1/{omadacId}/sites/{siteId}/ap-groups/{apGroupId}/info

**Get an existing AP Group info** — Get an existing AP Group info<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager View Only<br/>Network Config Page View Only<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.

Parameters:
- apGroupId (path, required): string — AP GROUP ID

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - id: string — AP group ID
  - name: string — ap group name should contain 1 to 128 characters.
  - primary: boolean — Whether it is the default ap group
  - apNum: integer — Number of APs in this group
  - remainingBinding: object — Number of SSID remaining bindings for this group, 0:2g, 1:5g, 2:6g
  - ssidNameList: array<string> — SSID name list bound to this group
```

## PATCH /openapi/v1/{omadacId}/sites/{siteId}/ap-groups/{apGroupId}

**Modify an existing AP Group** — Modify an existing AP Group<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager Modify<br/>Network Config Page Modify<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.<br/>-33200 - This WLAN group has been already created.

Parameters:
- apGroupId (path, required): string — AP GROUP ID

Request body (* = required):
```
- name*: string — AP group name should contain 1 to 128 characters.
- addApMacs: array<string> — List of AP device MAC addresses to be added to this AP group. Can be empty.
- removeApMacs: array<string> — List of AP device MAC addresses to be removed from this AP group. Can be empty.
```

Response 200:
```
- errorCode: integer
- msg: string
```

## DELETE /openapi/v1/{omadacId}/sites/{siteId}/ap-groups/{apGroupId}

**Delete an existing AP Group** — Delete an existing AP Group<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager Modify<br/>Network Config Page Modify<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33203 - The default WLAN group cannot be deleted.

Parameters:
- apGroupId (path, required): string — AP GROUP ID

Response 200:
```
- errorCode: integer
- msg: string
```

## GET /openapi/v1/{omadacId}/sites/{siteId}/ap-groups/aps

**Get All AP grouping by ap group** — Get All AP grouping by ap group<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager View Only<br/>Network Config Page View Only<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.

Parameters:
- page (query, required): integer — Start page number. Start from 1.
- pageSize (query, required): integer — Number of entries per page. It should be within the range of 1–1000.

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - totalRows: integer — Total rows of all items.
  - currentPage: integer — Current page number.
  - currentSize: integer — Number of entries per page.
  - data: array<SsidDeviceOpenApiVO>
    - id: string — Device ID
    - mac: string — Device MAC address
    - name: string — Device name
    - model: string — Device model
    - modelVersion: string — Device model version
    - apGroupName: string — AP Group Name
    - apGroupId: string — apGroupId
    - clientNum: integer — number of clients connected to Device
    - traffic: integer — total traffic of Device
    - deviceType: string — Device type, such as EAP, Gateway
    - ip: string — Ip address,such as 192.168.0.105
    - showModel: string — Model complex shown in the front end.Ap：model+(country)+modelVersion,EAP225(EU) v3.0 Gateway/Switch：model+modelVersion,Osg v3.0
    - status: integer — Status of device,status should be a value as follows: 0:Disconnected;1:Disconnected(Migrating);10:Provisioning;11:Configuring;12:Upgrading;13:Rebooting;14:Connected;15:Connected(Wireless);16:Connected(Migrating);17:Conne
    - statusCategory: integer — Category of device status,statusCategory should be a value as follows: 0:Disconnected;1:Connected;2:Pending;3:Heartbeat Missed;4:Isolated
    - overrideNum: integer — Override ssid number for AP
```

## GET /openapi/v1/{omadacId}/sites/{siteId}/count-ap-groups

**Check if the number of AP Groups is out of limit** — Check if the number of AP Groups is out of limit. The value of "ApGroupNum" indicates number of AP group and the value of "exceeded" indicates whether the number of AP Groups exceeds the limit. The limit is the total number that a Controller can create, not the limit of a single Site.<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager View Only<br/>Network Config Page View Only<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - exceeded: boolean — whether the number of AP Groups exceeds the limit
  - apGroupNum: integer — the number of AP Groups
```

## PATCH /openapi/v1/{omadacId}/sites/{siteId}/aps/{apMac}/wlan-group

**Switch AP's wlan group** — Switch AP's wlan group<br/><br/>The interface requires one of the permissions: <br/>Site Device Manager Modify<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-39303 - AP does not exist.

Parameters:
- apMac (path, required): string — AP MAC address, like AA-BB-CC-DD-EE-FF

Request body (* = required):
```
- wlanGroupId*: string — The wlan group Id that the AP should switch to, must be in the same site as the AP and cannot be the current wlan group.
```

Response 200:
```
- errorCode: integer
- msg: string
```

## GET /openapi/v2/{omadacId}/sites/{siteId}/wireless-network/ssids

**Get SSID list by site** — Get SSID list by site<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager View Only<br/>Network Config Page View Only<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-1300 - Failed to get site information.

Parameters:
- page (query, required): integer — Start page number. Start from 1.
- pageSize (query, required): integer — Number of entries per page. It should be within the range of 1–1000.

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - totalRows: integer — Total rows of all items.
  - currentPage: integer — Current page number.
  - currentSize: integer — Number of entries per page.
  - data: array<SsidOpenApiVO>
    - ssidId: string — SSID ID, kept for backward compatibility and equivalent to id. This field will be removed in a future release; use id instead.
    - id: string — SSID ID
    - name: string — SSID name. It should contain 1 to 32 UTF-8 characters.
    - description: boolean — SSID Enable status.
    - chooseDevices: integer
    - band: integer — SSID band. The lowest bit indicates whether 2.4G is included; the second lowest bit indicates whether 5G is included; the third lowest bit indicates whether 6G is included; 1 means included while 0 means not included. Fo
    - guestNetEnable: boolean — SSID guest network config status. True: enable, false: disable.
    - security: integer — SSID security mode; Security should be a value as follows: 0: None; 2: WPA-Enterprise; 3: WPA-Personal; 4: PPSK without RADIUS; 5: PPSK with RADIUS.
    - broadcast: boolean — SSID broadcast config status. True: enable, false: disable.
    - vlanEnable: boolean — SSID VLAN config status. True: enable, false: disable.
    - vlanId: integer — SSID VLAN ID. This field is required when Parameter [vlanEnable] is true; It should be within the range of 1–4094.
    - vlanPoolIds: string — SSID VLAN POOL IDs. This field is required when Parameter [vlanEnable] is true; The numbers contain in it should be within the range of 1–4094.
```

## POST /openapi/v2/{omadacId}/sites/{siteId}/wireless-network/ssids

**Create new SSID v2** — Create new SSID v2<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager Modify<br/>Network Config Page Modify<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.<br/>-33217 - Invalid SSID security mode.<br/>-33219 - This SSID already exists.<br/>-33220 - Enter a different SSID to override the current SSID.<br/>-33231 - The ssid' s name should not be the same with emergency ssid.<br/>-33240 - The SSID name should be between 1 and 32 bytes.<br/>-33788 - PPSK and OUI Based VLAN are mutually exclusive. Please make sure the SSID is not enabled in OUI Based VLAN.<br/>-33807 - Invalid VLAN ID. Enter a number from 1 to 4094.<br/>-34017 - Only the EKMS authentication method in PPSK with RADIUS supports domain name.

Request body (* = required):
```
- name*: string — SSID name. It should contain 1 to 32 UTF-8 characters.
- deviceType*: integer — SSID device type, identify which devices this SSID will take effect; The lowest bit indicates whether [EAP] is included, the second low bit indicates whether [Gateway] is included, 1 means included while 0 means not incl
- ssidEnable: boolean — SSID enable status. True: enable, false: disable.
- chooseDevices: integer — description = select all devices or not. 0 means select all devices, 1 means not select all devices.
- apGroupIds: array<string> — AP Group ID list that the SSID is associated with. Supports binding to multiple AP groups.
- band*: integer — SSID band. The lowest bit indicates whether 2.4G is included; the second lowest bit indicates whether 5G is included; the third lowest bit indicates whether 6G is included; 1 means included while 0 means not included. Fo
- guestNetEnable*: boolean — SSID guest network config status. True: enable, false: disable.
- security*: integer — SSID security mode; Security should be a value as follows: 0: None; 2: WPA-Enterprise; 3: WPA-Personal; 4: PPSK without RADIUS; 5: PPSK with RADIUS.
- broadcast*: boolean — SSID broadcast config status. True: enable, false: disable.
- vlanEnable*: boolean — SSID VLAN config status. True: enable, false: disable.
- vlanId: integer — SSID VLAN ID. This field is required when Parameter [vlanEnable] is true; It should be within the range of 1–4094. If the field vlanSetting is entered, this field must be null.
- pskSetting: object — WPA-Personal SSID config. This is necessary when the value of security is 3(WPA-Personal), 4(PPSK without RADIUS), 5(PPSK with RADIUS).
  - securityKey: string — WPA-Personal SSID password. This is necessary when the value of security is 3(WPA-Personal);It should contain 8-63 printable ASCII characters or 8-63 hexadecimal digits.
  - versionPsk*: integer — WPA-Personal version. This is necessary when the value of security is 3(WPA-Personal); It should be a value as follows: 1: WPA-PSK; 2: WPA2-PSK; 3: WPA/WPA2-PSK; 4: WPA2-PSK/WPA3-SAE (or WPA3-SAE for 6 GHz-only SSIDs). T
  - encryptionPsk*: integer — WPA-Personal encryption. This is necessary when the value of security is 3(WPA-Personal); It should be a value as follows: 1: Auto; 3: AES; When versionPsk is WPA3-SAE, Parameter [encryptionPsk] must be AES.
  - gikRekeyPskEnable*: boolean — WPA-Personal SSID group key update period config status. True: enable, false: disable.
  - rekeyPskInterval: integer — WPA-Personal SSID group key update period interval config. When the value of Parameter [intervalPskType] is 0 (Seconds), it should be within the range of 30-86400; when the value of Parameter [intervalPskType] is 1 (Minu
  - intervalPskType: integer — WPA-Personal SSID group key update period interval unit config. It should be a value as follows: 0: Seconds; 1: Minutes; 2: Hours.
- entSetting: object — WPA-Enterprise SSID config. This is necessary when the value of security is 2(WPA-Enterprise).
  - radiusProfileId*: string — This field represents RADIUS Profile ID. RADIUS Profile(RADIUS Profile Template) can be created using Create a new RADIUS profile(Create a new RADIUS profile template) interface, and RADIUS Profile ID(RADIUS Profile Temp
  - versionEnt*: integer — WPA-Enterprise version. This is necessary when the value of security is 2(WPA-Enterprise); It should be a value as follows: 1: WPA-Enterprise; 2: WPA2-Enterprise; 3: WPA/WPA2-Enterprise; 4.WPA3-Enterprise.
  - encryptionEnt*: integer — WPA-Enterprise encryption. This is necessary when the value of security is 2(WPA-Enterprise); It should be a value as follows: 1: Auto; 3: AES; 4: AES-GCM 256; 5:AES-CNSA; 6:CCMP_128; When versionEnt is WPA3-Enterprise, 
  - gikRekeyEntEnable*: boolean — WPA-Enterprise SSID group key update period config status. True: enable, false: disable.
  - rekeyEntInterval: integer — WPA-Enterprise SSID group key update period interval config. When the value of Parameter [intervalEntType] is 0(Seconds), it should be within the range of 30-86400; when the value of Parameter [intervalEntType] is 1(Minu
  - intervalEntType: integer — WPA-Enterprise SSID group key update period interval unit config. It should be a value as follows: 0: Seconds; 1: Minutes; 2: Hours.
  - nasIdMode: integer — Indicates the status of nasid under enterprise-level encryption. It should be a value as follows: 0: default (TP LINK: MAC Address), 1: follow device name, 2: custom.
  - nasId: string — This field is necessary when the nasIdMode type is custom.
- ppskSetting: object — PPSK without RADIUS/PPSK without RADIUS SSID config. This is necessary when the value of security is 4(PPSK without RADIUS), 5(PPSK with RADIUS).
  - ppskProfileId: string — This field represents PPSK Profile ID; This is necessary when the value of security is 4(PPSK without RADIUS); PPSK Profile(PPSK Profile Template) can be created using Create PPSK profile interface(Create PPSK profile te
  - radiusProfileId: string — This field represents RADIUS Profile ID; This is necessary when the value of security is 5(PPSK with RADIUS); RADIUS Profile(RADIUS Profile Template) can be created using Create a new RADIUS profile(Create a new RADIUS p
  - macFormat: integer — MAC address format. This is necessary when the value of security is 5(PPSK with RADIUS); It should be a value as follows: 0: aabbccddeeff; 1: aa-bb-cc-dd-ee-ff; 2: aa:bb:cc:dd:ee:ff; 3: AABBCCDDEEFF; 4: AA-BB-CC-DD-EE-FF
  - nasId: string — NAS ID. This is necessary when the value of security is 5(PPSK with RADIUS); It should contain 1 to 64 characters.
  - type: integer — Authentication type. This is necessary when the value of security is 5(PPSK with RADIUS); It should be a value as follows: 0: Mac Auth(Generic RADIUS with bound MAC); 1: EKMS(This configuration applies to the Pro Site of
- mloEnable*: boolean — SSID MLO config status. True: enable, false: disable.
- pmfMode*: integer — SSID PMF mode. It should be a value as follows: 1: Mandatory; 2: Capable; 3: Disable.
- enable11r*: boolean — SSID 802.11r config status. True: enable, false: disable.
- hidePwd*: boolean — If this field is true, the SSID password will be hidden.
- greEnable: boolean — SSID EoGre Tunnel config status. True: enable, false: disable. This configuration can be enabled only when the [VPN - EoGre Tunnel] global config is enabled;(This configuration applies to the Pro Site of the Omada Pro Co
- vlanSetting: object — This field is required when Parameter [vlanEnable] is true. A newly added field is added to set the SSID VLAN configuration. If the field vlanId is entered, this field must be null.
  - mode*: integer — should be a value as follows: 0:Default; 1:Custom.
  - customConfig: object — If mode=1, this field must be entered.
    - customMode*: integer — If mode=1, this field must be entered.If a device does not support multiple VLANs, the smallest VLAN you configured will be applied to the SSID. customMode should be a value as follows: 0:by Network; 1:by Vlan.
    - lanNetworkId: string — lanNetworkId. If support vlan pool, use lanNetworkVlanIds instead. If customMode=1, this filed must be null. If both lanNetwork and lanNetworkVlanIds parameters exist, the vlanId will actually take effect with the lanNet
    - bridgeVlan: integer — bridgeVlan. If support vlan pool, use lanNetworkVlanIds instead. If customMode=1, this filed must be null.
    - vlanId: integer — vlanId. If support vlanPool, use vlanPoolIds instead. If customMode=0, this filed must be null. If both the vlanId and vlanPoolIds parameters exist, the vlanId will actually take effect at the minimum value in the vlanPo
    - lanNetworkVlanIds: object — Indicates the mapping between the lanNetworkId and the vlanId, and if the lanNetwork corresponds to a bridgeVlan, multiple vlanIds may correspond. If customMode=1, this filed must be null. Cbc Pro does not support this f
    - vlanPoolIds: string — When customMode=1 needs to have a value. If customMode=0, this filed must be null. Cbc Pro does not support this filed.
- prohibitWifiShare: boolean — SSID prohibitWifiShare config status. True: enable, false: disable.
- wifiCallingEnable: boolean — SSID Wifi Calling config status. True: enable, false: disable.
- wifiCallingId: string — The ID of the Wi-Fi calling profile bound to the SSID. When parameter [wifiCallingEnable] is true, it should not be null.
- enhancedIotConnectivity: boolean — SSID Enhanced IoT Connectivity config status. True: enable, false: disable. This configuration can be enabled only when the 5GHz and 6GHz bands are disabled, the parameters [versionEnt] and [versionPsk] are not set to 4,
- CondBroadcastCtrl: object — Condition Broadcast Control config.
  - enable: boolean — enable
  - condition: integer — 0: uplink down, 1: Internet down.
  - upTime: integer — SSID Uplink Time
  - downTime: integer — SSID Downlink Time
```

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - id: string — SSID ID
```

## GET /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}

**Get SSID detail info** — Get SSID detail info<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager View Only<br/>Network Config Page View Only<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.

Parameters:
- ssidId (path, required): string — SSID ID

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - ssidId: string — SSID ID, kept for backward compatibility and equivalent to id. This field will be removed in a future release; use id instead.
  - id: string — SSID ID
  - name: string — SSID name. It should contain 1 to 32 UTF-8 characters.
  - band: integer — SSID band. The lowest bit indicates whether 2.4G is included; the second lowest bit indicates whether 5G is included; the third lowest bit indicates whether 6G is included; 1 means included while 0 means not included. Fo
  - autoWanAccess: boolean — Whether to enable auto wan access. True: enable, false: disable.
  - guestNetEnable: boolean — SSID guest network config status. True: enable, false: disable.
  - security: integer — SSID security mode; Security should be a value as follows: 0: None; 2: WPA-Enterprise; 3: WPA-Personal; 4: PPSK without RADIUS; 5: PPSK with RADIUS.
  - oweEnable: boolean — Opportunistic Wireless Encryption, also known as Enhanced Open, is a certification provided by the Wi-Fi Alliance as part of the WPA3 wireless security standard. OWE will enable two wireless VAPs per radio, one for acces
  - broadcast: boolean — SSID broadcast config status. True: enable, false: disable.
  - vlanEnable: boolean — SSID VLAN config status. True: enable, false: disable.
  - vlanId: integer — SSID VLAN ID. This field is required when Parameter [vlanEnable] is true; It should be within the range of 1–4094.
  - hidePwd: boolean — If this field is true, the SSID password will be hidden.
  - vlanSetting: object — This field is required when Parameter [vlanEnable] is true. A newly added field is added to set the SSID VLAN configuration. If the field vlanId is entered, this field must be null.
    - mode*: integer — should be a value as follows: 0:Default; 1:Custom.
    - customConfig: object — If mode=1, this field must be entered.
      - customMode*: integer — If mode=1, this field must be entered.If a device does not support multiple VLANs, the smallest VLAN you configured will be applied to the SSID. customMode should be a value as follows: 0:by Network; 1:by Vlan.
      - lanNetworkId: string — lanNetworkId. If support vlan pool, use lanNetworkVlanIds instead. If customMode=1, this filed must be null. If both lanNetwork and lanNetworkVlanIds parameters exist, the vlanId will actually take effect with the lanNet
      - bridgeVlan: integer — bridgeVlan. If support vlan pool, use lanNetworkVlanIds instead. If customMode=1, this filed must be null.
      - vlanId: integer — vlanId. If support vlanPool, use vlanPoolIds instead. If customMode=0, this filed must be null. If both the vlanId and vlanPoolIds parameters exist, the vlanId will actually take effect at the minimum value in the vlanPo
      - lanNetworkVlanIds: object — Indicates the mapping between the lanNetworkId and the vlanId, and if the lanNetwork corresponds to a bridgeVlan, multiple vlanIds may correspond. If customMode=1, this filed must be null. Cbc Pro does not support this f
      - vlanPoolIds: string — When customMode=1 needs to have a value. If customMode=0, this filed must be null. Cbc Pro does not support this filed.
  - pskSetting: object — WPA-Personal SSID config. This is necessary when the value of security is 3(WPA-Personal), 4(PPSK without RADIUS), 5(PPSK with RADIUS).
    - securityKey: string — WPA-Personal SSID password. This is necessary when the value of security is 3(WPA-Personal);It should contain 8-63 printable ASCII characters or 8-63 hexadecimal digits.
    - versionPsk*: integer — WPA-Personal version. This is necessary when the value of security is 3(WPA-Personal); It should be a value as follows: 1: WPA-PSK; 2: WPA2-PSK; 3: WPA/WPA2-PSK; 4: WPA2-PSK/WPA3-SAE (or WPA3-SAE for 6 GHz-only SSIDs). T
    - encryptionPsk*: integer — WPA-Personal encryption. This is necessary when the value of security is 3(WPA-Personal); It should be a value as follows: 1: Auto; 3: AES; When versionPsk is WPA3-SAE, Parameter [encryptionPsk] must be AES.
    - gikRekeyPskEnable*: boolean — WPA-Personal SSID group key update period config status. True: enable, false: disable.
    - rekeyPskInterval: integer — WPA-Personal SSID group key update period interval config. When the value of Parameter [intervalPskType] is 0 (Seconds), it should be within the range of 30-86400; when the value of Parameter [intervalPskType] is 1 (Minu
    - intervalPskType: integer — WPA-Personal SSID group key update period interval unit config. It should be a value as follows: 0: Seconds; 1: Minutes; 2: Hours.
  - entSetting: object — WPA-Enterprise SSID config. This is necessary when the value of security is 2(WPA-Enterprise).
    - radiusProfileId*: string — This field represents RADIUS Profile ID. RADIUS Profile(RADIUS Profile Template) can be created using Create a new RADIUS profile(Create a new RADIUS profile template) interface, and RADIUS Profile ID(RADIUS Profile Temp
    - versionEnt*: integer — WPA-Enterprise version. This is necessary when the value of security is 2(WPA-Enterprise); It should be a value as follows: 1: WPA-Enterprise; 2: WPA2-Enterprise; 3: WPA/WPA2-Enterprise; 4.WPA3-Enterprise.
    - encryptionEnt*: integer — WPA-Enterprise encryption. This is necessary when the value of security is 2(WPA-Enterprise); It should be a value as follows: 1: Auto; 3: AES; 4: AES-GCM 256; 5:AES-CNSA; 6:CCMP_128; When versionEnt is WPA3-Enterprise, 
    - gikRekeyEntEnable*: boolean — WPA-Enterprise SSID group key update period config status. True: enable, false: disable.
    - rekeyEntInterval: integer — WPA-Enterprise SSID group key update period interval config. When the value of Parameter [intervalEntType] is 0(Seconds), it should be within the range of 30-86400; when the value of Parameter [intervalEntType] is 1(Minu
    - intervalEntType: integer — WPA-Enterprise SSID group key update period interval unit config. It should be a value as follows: 0: Seconds; 1: Minutes; 2: Hours.
    - nasIdMode: integer — Indicates the status of nasid under enterprise-level encryption. It should be a value as follows: 0: default (TP LINK: MAC Address), 1: follow device name, 2: custom.
    - nasId: string — This field is necessary when the nasIdMode type is custom.
  - ppskSetting: object — PPSK without RADIUS/PPSK without RADIUS SSID config. This is necessary when the value of security is 4(PPSK without RADIUS), 5(PPSK with RADIUS).
    - ppskProfileId: string — This field represents PPSK Profile ID; This is necessary when the value of security is 4(PPSK without RADIUS); PPSK Profile(PPSK Profile Template) can be created using Create PPSK profile interface(Create PPSK profile te
    - radiusProfileId: string — This field represents RADIUS Profile ID; This is necessary when the value of security is 5(PPSK with RADIUS); RADIUS Profile(RADIUS Profile Template) can be created using Create a new RADIUS profile(Create a new RADIUS p
    - macFormat: integer — MAC address format. This is necessary when the value of security is 5(PPSK with RADIUS); It should be a value as follows: 0: aabbccddeeff; 1: aa-bb-cc-dd-ee-ff; 2: aa:bb:cc:dd:ee:ff; 3: AABBCCDDEEFF; 4: AA-BB-CC-DD-EE-FF
    - nasId: string — NAS ID. This is necessary when the value of security is 5(PPSK with RADIUS); It should contain 1 to 64 characters.
    - type: integer — Authentication type. This is necessary when the value of security is 5(PPSK with RADIUS); It should be a value as follows: 0: Mac Auth(Generic RADIUS with bound MAC); 1: EKMS(This configuration applies to the Pro Site of
  - mloEnable: boolean — SSID MLO config status. True: enable, false: disable.
  - pmfMode: integer — SSID PMF mode. It should be a value as follows: 1: Mandatory; 2: Capable; 3: Disable.
  - enable11r: boolean — SSID 802.11r config status. True: enable, false: disable.
  - clientRateLimit: object — SSID rate limit config.
    - profileId: string — This field represents RateLimit Profile ID. RateLimit Profile can be created using Create rate limit profile interface, and RateLimit Profile ID can be obtained from Get rate limit profile list interface.(The validity pr
    - customSetting: object — Rate limit custom setting
      - downLimitEnable*: boolean — Whether to limit downlink speed; This field is required when select custom setting. True: enable, false: disable.
      - downLimit: integer — Downlink speed limit value. When the value of Parameter [downLimitType] is 0(Kbps), downLimit should be within the range of 1–10485760; when the value of Parameter [downLimitType] is 1(Mbps), downLimit should be within t
      - downLimitType: integer — Downlink speed limit unit config; DownLimitType should be a value as follows: 0: Kbps; 1: Mbps.
      - upLimitEnable*: boolean — Whether to limit uplink speed; This field is required when select custom setting. True: enable, false: disable.
      - upLimit: integer — Uplink speed limit value. When the value of Parameter [upLimitType] is 0(Kbps), upLimit should be within the range of 1–10485760; when the value of Parameter [upLimitType] is 1(Mbps), upLimit should be within the range o
      - upLimitType: integer — Uplink speed limit unit config; UpLimitType should be a value as follows: 0: Kbps; 1: Mbps.
  - ssidRateLimit: object — SSID rate limit config.
    - profileId: string — This field represents RateLimit Profile ID. RateLimit Profile can be created using Create rate limit profile interface, and RateLimit Profile ID can be obtained from Get rate limit profile list interface.(The validity pr
    - customSetting: object — Rate limit custom setting
      - downLimitEnable*: boolean — Whether to limit downlink speed; This field is required when select custom setting. True: enable, false: disable.
      - downLimit: integer — Downlink speed limit value. When the value of Parameter [downLimitType] is 0(Kbps), downLimit should be within the range of 1–10485760; when the value of Parameter [downLimitType] is 1(Mbps), downLimit should be within t
      - downLimitType: integer — Downlink speed limit unit config; DownLimitType should be a value as follows: 0: Kbps; 1: Mbps.
      - upLimitEnable*: boolean — Whether to limit uplink speed; This field is required when select custom setting. True: enable, false: disable.
      - upLimit: integer — Uplink speed limit value. When the value of Parameter [upLimitType] is 0(Kbps), upLimit should be within the range of 1–10485760; when the value of Parameter [upLimitType] is 1(Mbps), upLimit should be within the range o
      - upLimitType: integer — Uplink speed limit unit config; UpLimitType should be a value as follows: 0: Kbps; 1: Mbps.
  - wlanSchedule: object — SSID WLAN schedule config.
    - wlanScheduleEnable: boolean — SSID WLAN schedule global config status. True: enable, false: disable.
    - action: integer — 0 means radio off, indicating the Wi-Fi function is off during the selected period; 1 means radio on, indicating the Wi-Fi function is on during the selected period.
    - scheduleId: string — This field represents Time Range Profile ID. Time Range Profile can be created using Create time range profile interface, and Time Range Profile ID can be obtained from Get time range profile list interface.
  - rateControl: object — SSID 802.11 Rate Control config.
    - rate2gCtrlEnable: boolean — Whether to enable 2.4GHz Data Rate Control
    - lowerDensity2g: number — 2.4GHz Data Rate Control lower density value(Unit: Mbps); It should be a value as follows: [1, 2, 5.5, 6, 9, 11, 12, 18, 24, 36, 48, 54].
    - higherDensity2g: integer — 2.4GHz Data Rate Control higher density value(Unit: Mbps); It should be a value as follows: [54].
    - cckRatesDisable: boolean — Whether to disable 2G CCK Rates. If this field is true, Parameter [lowerDensity2g] can not enter the following values: [1, 2, 5.5, 11].
    - clientRatesRequire2g: boolean — Whether to require clients to use rates at or above the specified value of 2.4GHz Data Rate Control.
    - sendBeacons2g: boolean — Whether to enable send beacons at 1Mbps of 2.4GHz Data Rate Control.
    - rate5gCtrlEnable: boolean — Whether to enable 5GHz Data Rate Control.
    - lowerDensity5g: integer — 5GHz Data Rate Control lower density value(Unit: Mbps); It should be a value as follows: [6, 9, 12, 18, 24, 36, 48, 54].
    - higherDensity5g: integer — 5GHz Data Rate Control higher density value(Unit: Mbps); It should be a value as follows: [54].
    - clientRatesRequire5g: boolean — Whether to require clients to use rates at or above the specified value of 5GHz Data Rate Control.
    - sendBeacons5g: boolean — Whether to enable send beacons at 6Mbps of 5GHz Data Rate Control.
    - rate6gCtrlEnable: boolean — Whether to enable 6GHz Data Rate Control.
    - lowerDensity6g: integer — 6GHz Data Rate Control lower density value(Unit: Mbps); It should be a value as follows: [6, 9, 12, 18, 24, 36, 48, 54].
    - higherDensity6g: integer — 6GHz Data Rate Control higher density value(Unit: Mbps); It should be a value as follows: [54].
    - clientRatesRequire6g: boolean — Whether to require clients to use rates at or above the specified value of 6GHz Data Rate Control.
    - sendBeacons6g: boolean — Whether to enable send beacons at 6Mbps of 6GHz Data Rate Control.
    - manageRateControl2gEnable: boolean — Whether to enable 2.4GHz Manage Rate Control.
    - manageRateControl2g: number — 2.4GHz Manage Rate Control lower density value(Unit: Mbps); It should be a value as follows: [1, 2, 5.5, 6, 9, 11, 12, 18, 24, 36, 48, 54]. The higher density value is fixed at 54.
    - manageRateControl5gEnable: boolean — Whether to enable 5GHz Manage Rate Control.
    - manageRateControl5g: integer — 5GHz Manage Rate Control lower density value(Unit: Mbps); It should be a value as follows: [6, 9, 12, 18, 24, 36, 48, 54]. The higher density value is fixed at 54.
  - macFilter: object — SSID MAC Filter config.
    - macFilterEnable: boolean — SSID MAC Filter global config status. True: enable, false: disable.
    - policy: integer — SSID MAC Filter policy config mode; It should be a value as follows: 0: Deny List, 1: Allow List.
    - macFilterId: string — This field represents MAC Group Profile ID. MAC Group Profile can be created using Create a new group profile interface, and MAC Group Profile ID can be obtained from Get group profile list by type interface.
    - ouiProfileIdList: array<string> — This field represents OUI Profile ID list. OUI Profile can be created using Create OUI profile interface, and OUI Profile ID can be obtained from Get OUI profile summary list interface.
  - multiCast: object — SSID Multicast/Broadcast Management config.
    - multiCastEnable: boolean — Whether to enable multicast to unicast, which is enabled by default. True: enable, false: disable.
    - ipv6CastEnable: boolean — Whether to enable IPv6 multicast to unicast, which is enabled by default. True: enable, false: disable.
    - channelUtil: integer — This item indicates that when the channel utilization reaches the threshold, multicast will no longer be converted to unicast, the default threshold is 100, and the value should be within the range of 0-100.
    - arpCastEnable: boolean — Whether to enable ARP cast to unicast, which is enabled by default. True: enable, false: disable.
    - filterEnable: boolean — Whether to enable the multicast filter switch, which is disabled by default. True: enable, false: disable.
    - filterMode: integer — This item indicates the status of the filtering protocol. The lowest bit indicates whether IGMP is enabled; the second lowest bit indicates whether MDNS is enabled; and the third lowest bit indicates whether Others is en
    - macGroupId: string — This field represents MAC Group Profile ID. MAC Group Profile can be created using Create a new group profile interface, and MAC Group Profile ID can be obtained from Get group profile list by type interface.
  - dhcpOption82: object — SSID DHCP Option 82 config.
    - dhcpEnable: boolean — SSID DHCP Option 82 global config status. True: enable, false: disable.
    - format: integer — SSID DHCP Option 82 format config; It should be a value as follows: 0: ASCII; 1: Binary.
    - delimiter: string — SSID DHCP Option 82 delimiter config (A single arbitrary ASCII character is acceptable).
    - circuitId: array<integer> — SSID DHCP Option 82 Circuit-ID config. Circuit-ID is an array formed in the selected order, with each array element corresponding to the following enumeration values: 1: VLAN-ID; 2: AP Radio Mac-Address; 3: SSID-Type; 4:
    - remoteId: array<integer> — SSID DHCP Option 82 Remote-ID config. Remote-ID is an array formed in the selected order, with each array element corresponding to the following enumeration values: 1: VLAN-ID; 2: AP Radio Mac-Address; 3: SSID-Type; 4: S
  - deviceType: integer — SSID device type, identify which devices this SSID will take effect. The lowest bit indicates whether [EAP] is included, the second low bit indicates whether [Gateway] is included, 1 means included while 0 means not incl
  - ssidEnable: boolean — SSID enable status. True: enable, false: disable.
  - chooseDevices: integer — description = select all devices or not. 0 means select all devices, 1 means not select all devices.
  - prohibitWifiShare: boolean — SSID prohibitWifiShare config status. True: enable, false: disable.
  - hotspotV2Setting: object — Hotspot 2.0 is a WFA (Wi-Fi Alliance) technical specification based on IEEE 802.11u protocol.<br />It provides a simplified mechanism for wireless clients to discover and connect to suitable networks and switch seamlessl
    - hotspotV2Enable*: boolean — Whether Hotspot2.0 is enabled.<br />If hotspot2.0 is disabled, other parameters in Hotspot2.0 will be invalid.
    - networkType: integer — Specify the 802.11u network type.<br /> Parameter networkType should be a value as follows: [0: Private network; 1: Private network with guest access; 2: Chargeable public network; 3: Free public network; 4: Personal dev
    - plmnId: array<PlmnIdOpenApiVO> — PLMN ID list, enter PLMN ID of 802.11u 3GPP cellular network.<br />Note: Up to 6 entries are allowed for the PLMN ID list.
      - value: string — Public Land Mobile Network ID.<br />Note: It should be between 10000 and 999999.
    - roamingConsortiumOi: array<RoamingConsortiumOiOpenApiVO> — Roaming Consortium Oi list, enter the 802.11u roaming organization identifiers.<br />Note: Up to 3 entries are allowed for the Roaming Consortium Oi list.
      - value: string — Roaming Consortium Operator Identifier.<br />Note: Roaming Consortium Oi should conform to XX-XX-XX or XX-XX-XX-XX-XX format(Hexadecimal).
    - operatorDomain: string — Enter the domain name of the hotspot operator.<br />For example, www.omadanetworks.com.
    - dgafDisable: boolean — Whether to enable DGAF(downstream group-addressed forwarding) disable mode.<br />In DGAF disable mode, the AP will not forward downstream multicast and broadcast packets.
    - heSsid: string — Homogenous Extended Service Set Identifier, it is used to identify the same type of ESS network set.<br />Note: HESSID should be consistent with one of the BSSIDs of the APs in the zone.
    - internet: boolean — Internet access support status (network reachability), which indicates that the network is allowed to access the Internet.
    - availabilityIpv4: integer — Available type information of IPv4 addresses.<br />Parameter availabilityIpv4 should be a value as follows: [0: Address type not available; 1: Public IPv4 address available; 2: Port-restricted IPv4 address available; 3: 
    - availabilityIpv6: integer — Available type information of IPv6 addresses.<br /> Parameter availabilityIpv6 should be a value as follows: [0: Address type not available; 1: Address type available; 2: Availability of the address type not known].
    - operatorFriendly: string — Hotspot network operator friendly name.<br />Note:Parameter operatorFriendly should contain between 1 and 64 visible ASCII characters, with no Spaces at the beginning and end, and Spaces in between.
    - venueInfo: object — Indicates the venue information using the combination of the network's venue group and venue type (using the international building code).
      - group*: integer — Venue Group.Parameter group should be a value as follows: [0: Unspecified; 1: Assembly; 2: Business; 3: Educational; 4: Factory and Industrial; 5: Institutional; 6: Mercantile; 7: Residential; 8: Storage; 9: Utility and 
      - type*: integer — Venue Type.When Venue Group = 0, type should be a value as follows:[0: Unspecified]When Venue Group = 1, type should be a value as follows:[0: Unspecified Assembly;1: Arena;2: Stadium;3: Passenger Terminal (e.g., airport
      - name: string — Network’s venue name, identifying the physical location of the network.<br />Note: It should contain between 1 and 64 visible ASCII characters, with no Spaces at the beginning and end, and Spaces in between.
    - realmList: array<RealmOpenApiVO> — Add a profile to identify and describe a NAI (Network Access Identifier) realm accessible using the AP, and the method that this NAI realm uses for authentication.<br />Note: Up to 10 entries are allowed for the NAI Real
      - name*: string — The name of the NAI realm. Usually the domain name of the service provider.<br />Note: It should contain 1 to 64 UTF-8 characters.
      - encoding*: integer — Encoding format.<br />Parameter encoding should be a value as follows:[0:RFC4282;1:UTF-8].
      - eap*: array<EapMethodOpenApiVO> — EAP Method list.<br />Note: Up to 4 entries are allowed for the EAP Method list.
  - wifiCallingEnable: boolean — SSID Wifi Calling config status. True: enable, false: disable.
  - wifiCallingId: string — The ID of the Wi-Fi calling profile bound to the SSID. When parameter [wifiCallingEnable] is true, it should not be null.
  - ssidDhcpOption: object — SSID Band Steer config.
    - mode*: integer — should be a value as follows: 0:Disable; 1:Prefer 5GHz/6GHz; 2:Balance; 3:Use site setting.
  - apGroupIds: array<string> — List of AP Group IDs associated with this SSID
  - enhancedIotConnectivity: boolean — SSID Enhanced IoT Connectivity config status. True: enable, false: disable. This configuration can be enabled only when the 5GHz and 6GHz bands are disabled, the parameters [versionEnt] and [versionPsk] are not set to 4,
```

## DELETE /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}

**Delete an existing SSID** — Delete an existing SSID<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager Modify<br/>Network Config Page Modify<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.

Parameters:
- ssidId (path, required): string — SSID ID

Response 200:
```
- errorCode: integer
- msg: string
- result: object
```

## PATCH /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/basic-config

**Update SSID basic config by site** — Update SSID basic config by site<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager Modify<br/>Network Config Page Modify<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.<br/>-33217 - Invalid SSID security mode.<br/>-33219 - This SSID already exists.<br/>-33220 - Enter a different SSID to override the current SSID.<br/>-33231 - The ssid' s name should not be the same with emergency ssid.<br/>-33235 - PPSK without RADIUS do not support WPA Mode with WPA3-SAE.<br/>-33238 - The number of SSIDs on %band% has reached the limit. At most 8 SSIDs can be created on each band.<br/>-33240 - The SSID name should be between 1 and 32 bytes.<br/>-33807 - Invalid VLAN ID. Enter a number from 1 to 4094.<br/>-34017 - Only the EKMS authentication method in PPSK with RADIUS supports domain name.

Parameters:
- ssidId (path, required): string — SSID ID

Request body (* = required):
```
- name*: string — SSID name. It should contain 1 to 32 UTF-8 characters.
- band*: integer — SSID band. The lowest bit indicates whether 2.4G is included; the second lowest bit indicates whether 5G is included; the third lowest bit indicates whether 6G is included; 1 means included while 0 means not included. Fo
- autoWanAccess: boolean — Whether to enable auto wan access. True: enable, false: disable.
- guestNetEnable*: boolean — SSID guest network config status. True: enable, false: disable.
- security*: integer — SSID security mode; Security should be a value as follows: 0: None; 2: WPA-Enterprise; 3: WPA-Personal; 4: PPSK without RADIUS; 5: PPSK with RADIUS.
- oweEnable: boolean — Opportunistic Wireless Encryption, also known as Enhanced Open, is a certification provided by the Wi-Fi Alliance as part of the WPA3 wireless security standard. OWE will enable two wireless VAPs per radio, one for acces
- broadcast*: boolean — SSID broadcast config status. True: enable, false: disable.
- vlanEnable*: boolean — SSID VLAN config status. True: enable, false: disable.
- vlanId: integer — SSID VLAN ID. This field is required when Parameter [vlanEnable] is true; It should be within the range of 1–4094. 
- pskSetting: object — WPA-Personal SSID config. This is necessary when the value of security is 3(WPA-Personal), 4(PPSK without RADIUS), 5(PPSK with RADIUS).
  - securityKey: string — WPA-Personal SSID password. This is necessary when the value of security is 3(WPA-Personal);It should contain 8-63 printable ASCII characters or 8-63 hexadecimal digits.
  - versionPsk*: integer — WPA-Personal version. This is necessary when the value of security is 3(WPA-Personal); It should be a value as follows: 1: WPA-PSK; 2: WPA2-PSK; 3: WPA/WPA2-PSK; 4: WPA2-PSK/WPA3-SAE (or WPA3-SAE for 6 GHz-only SSIDs). T
  - encryptionPsk*: integer — WPA-Personal encryption. This is necessary when the value of security is 3(WPA-Personal); It should be a value as follows: 1: Auto; 3: AES; When versionPsk is WPA3-SAE, Parameter [encryptionPsk] must be AES.
  - gikRekeyPskEnable*: boolean — WPA-Personal SSID group key update period config status. True: enable, false: disable.
  - rekeyPskInterval: integer — WPA-Personal SSID group key update period interval config. When the value of Parameter [intervalPskType] is 0 (Seconds), it should be within the range of 30-86400; when the value of Parameter [intervalPskType] is 1 (Minu
  - intervalPskType: integer — WPA-Personal SSID group key update period interval unit config. It should be a value as follows: 0: Seconds; 1: Minutes; 2: Hours.
- entSetting: object — WPA-Enterprise SSID config. This is necessary when the value of security is 2(WPA-Enterprise).
  - radiusProfileId*: string — This field represents RADIUS Profile ID. RADIUS Profile(RADIUS Profile Template) can be created using Create a new RADIUS profile(Create a new RADIUS profile template) interface, and RADIUS Profile ID(RADIUS Profile Temp
  - versionEnt*: integer — WPA-Enterprise version. This is necessary when the value of security is 2(WPA-Enterprise); It should be a value as follows: 1: WPA-Enterprise; 2: WPA2-Enterprise; 3: WPA/WPA2-Enterprise; 4.WPA3-Enterprise.
  - encryptionEnt*: integer — WPA-Enterprise encryption. This is necessary when the value of security is 2(WPA-Enterprise); It should be a value as follows: 1: Auto; 3: AES; 4: AES-GCM 256; 5:AES-CNSA; 6:CCMP_128; When versionEnt is WPA3-Enterprise, 
  - gikRekeyEntEnable*: boolean — WPA-Enterprise SSID group key update period config status. True: enable, false: disable.
  - rekeyEntInterval: integer — WPA-Enterprise SSID group key update period interval config. When the value of Parameter [intervalEntType] is 0(Seconds), it should be within the range of 30-86400; when the value of Parameter [intervalEntType] is 1(Minu
  - intervalEntType: integer — WPA-Enterprise SSID group key update period interval unit config. It should be a value as follows: 0: Seconds; 1: Minutes; 2: Hours.
  - nasIdMode: integer — Indicates the status of nasid under enterprise-level encryption. It should be a value as follows: 0: default (TP LINK: MAC Address), 1: follow device name, 2: custom.
  - nasId: string — This field is necessary when the nasIdMode type is custom.
- ppskSetting: object — PPSK without RADIUS/PPSK without RADIUS SSID config. This is necessary when the value of security is 4(PPSK without RADIUS), 5(PPSK with RADIUS).
  - ppskProfileId: string — This field represents PPSK Profile ID; This is necessary when the value of security is 4(PPSK without RADIUS); PPSK Profile(PPSK Profile Template) can be created using Create PPSK profile interface(Create PPSK profile te
  - radiusProfileId: string — This field represents RADIUS Profile ID; This is necessary when the value of security is 5(PPSK with RADIUS); RADIUS Profile(RADIUS Profile Template) can be created using Create a new RADIUS profile(Create a new RADIUS p
  - macFormat: integer — MAC address format. This is necessary when the value of security is 5(PPSK with RADIUS); It should be a value as follows: 0: aabbccddeeff; 1: aa-bb-cc-dd-ee-ff; 2: aa:bb:cc:dd:ee:ff; 3: AABBCCDDEEFF; 4: AA-BB-CC-DD-EE-FF
  - nasId: string — NAS ID. This is necessary when the value of security is 5(PPSK with RADIUS); It should contain 1 to 64 characters.
  - type: integer — Authentication type. This is necessary when the value of security is 5(PPSK with RADIUS); It should be a value as follows: 0: Mac Auth(Generic RADIUS with bound MAC); 1: EKMS(This configuration applies to the Pro Site of
- mloEnable*: boolean — SSID MLO config status. True: enable, false: disable.
- pmfMode*: integer — SSID PMF mode. It should be a value as follows: 1: Mandatory; 2: Capable; 3: Disable.
- enable11r*: boolean — SSID 802.11r config status. True: enable, false: disable.
- hidePwd: boolean — If this field is true, the SSID password will be hidden.
- greEnable: boolean — SSID EoGre Tunnel config status. True: enable, false: disable; This configuration can be enabled only when the [VPN - EoGre Tunnel] global config is enabled.
- vlanSetting: object — This field is required when Parameter [vlanEnable] is true. A newly added field is added to set the SSID VLAN configuration. If the field vlanId is entered, this field must be null.
  - mode*: integer — should be a value as follows: 0:Default; 1:Custom.
  - customConfig: object — If mode=1, this field must be entered.
    - customMode*: integer — If mode=1, this field must be entered.If a device does not support multiple VLANs, the smallest VLAN you configured will be applied to the SSID. customMode should be a value as follows: 0:by Network; 1:by Vlan.
    - lanNetworkId: string — lanNetworkId. If support vlan pool, use lanNetworkVlanIds instead. If customMode=1, this filed must be null. If both lanNetwork and lanNetworkVlanIds parameters exist, the vlanId will actually take effect with the lanNet
    - bridgeVlan: integer — bridgeVlan. If support vlan pool, use lanNetworkVlanIds instead. If customMode=1, this filed must be null.
    - vlanId: integer — vlanId. If support vlanPool, use vlanPoolIds instead. If customMode=0, this filed must be null. If both the vlanId and vlanPoolIds parameters exist, the vlanId will actually take effect at the minimum value in the vlanPo
    - lanNetworkVlanIds: object — Indicates the mapping between the lanNetworkId and the vlanId, and if the lanNetwork corresponds to a bridgeVlan, multiple vlanIds may correspond. If customMode=1, this filed must be null. Cbc Pro does not support this f
    - vlanPoolIds: string — When customMode=1 needs to have a value. If customMode=0, this filed must be null. Cbc Pro does not support this filed.
- prohibitWifiShare: boolean — SSID prohibitWifiShare config status. True: enable, false: disable.
- enhancedIotConnectivity: boolean — SSID Enhanced IoT Connectivity config status. True: enable, false: disable. This configuration can be enabled only when the 5GHz and 6GHz bands are disabled, the parameters [versionEnt] and [versionPsk] are not set to 4,
- CondBroadcastCtrl: object — Condition Broadcast Control config.
  - enable: boolean — enable
  - condition: integer — 0: uplink down, 1: Internet down.
  - upTime: integer — SSID Uplink Time
  - downTime: integer — SSID Downlink Time
```

Response 200:
```
- errorCode: integer
- msg: string
```

## PATCH /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/enable

**Update SSID Enable Status by site** — Update SSID Enable Status by site<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager Modify<br/>Network Config Page Modify<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.

Parameters:
- ssidId (path, required): string — SSID ID

Request body (* = required):
```
- ssidEnable*: boolean — Enable or disable the SSID
```

Response 200:
```
- errorCode: integer
- msg: string
```

## GET /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/ap-groups

**Query AP Groups bound to the SSID** — Query AP Groups bound to the SSID<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager View Only<br/>Network Config Page View Only<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-1300 - Failed to get site information.

Parameters:
- ssidId (path, required): string — SSID ID

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - apGroups: array<ApGroupDetailVO>
    - id: string — AP Group ID
    - name: string — AP Group Name
    - apNum: integer — Number of APs in this group
    - remainingBinding: object — Number of SSID remaining bindings for this group
  - maxSsids2G: integer — 2G radio max Ssid number in group
  - maxSsids5G: integer — 5G radio max Ssid number in group
  - maxSsids6G: integer — 6G radio max Ssid number in group
  - maxSsidsMlo: integer — max Mlo Ssid number in group
```

## PATCH /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/ap-groups

**Update SSID binding ap groups** — Update SSID binding ap groups<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager Modify<br/>Network Config Page Modify<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.

Parameters:
- ssidId (path, required): string — SSID ID

Request body (* = required):
```
- apGroupIds*: array<string> — AP GroupId List to bind with SSID. 
```

Response 200:
```
- errorCode: integer
- msg: string
```

## GET /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/duplicate-name

**Query SSIDs with the same name** — Query SSIDs with the same name<br/><br/>The interface requires one of the permissions: <br/>Site Settings Manager View Only<br/>Network Config Page View Only<br/><br/>The possible error code for the interface in the returned body is one of the following error codes (non generic error codes): <br/>-33000 - This site does not exist.

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - ssidNameMap: object — The SSIDs that are duplicated by site
  - duplicateSsidNames: array<string> — The SSID Names that are duplicated by site
  - siteId: string — The site ID
```

## GET /openapi/v1/{omadacId}/sites

**Get site list** — Get site list

Parameters:
- page (query, required): integer — Start page number. Start from 1.
- pageSize (query, required): integer — Number of entries per page. It should be within the range of 1–1000.
- sorts.name (query): string — Sort parameter may be one of asc or desc. Optional parameter. If it is not carried, it means it is not sorted by this field. When there are more than one, the first one takes effect
- searchKey (query): string — Fuzzy query parameters, support field name
- filters.tag (query): string — Filter query parameters, support field tag ID
- filters.type (query): string — Filter query parameters, support field site type. 0: basic site; 1: pro site.

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - totalRows: integer — Total rows of all items.
  - currentPage: integer — Current page number.
  - currentSize: integer — Number of entries per page.
  - data: array<SiteSummaryInfo>
    - siteId: string — Site ID
    - name: string — Name of the site should contain 1 to 64 characters.
    - tagIds: array<string> — Site tag ID
    - region: string — Country/Region of the site; For the values of region, refer to the abbreviation of the ISO country code; For example, you need to input "United States" for the United States of America.
    - timeZone: string — For the values of the timezone of the site, refer to section 5.1 of the Open API Access Guide.
    - scenario: string — For the values of the scenario of the site, refer to result of the interface for Get scenario list.
    - longitude: number — Longitude of the site should be within the range of -180 - 180.
    - latitude: number — Latitude of the site should be within the range of -90 - 90.
    - address: string — Address of the site
    - type: integer — Site type(only for pro controller). It should be a value as follows: 0: Basic Site; 1: Pro Site
    - supportES: boolean — Whether the site supports adopting Agile Series Switches
    - supportL2: boolean — Whether the site supports adopting Non-Agile Series Switches
    - sitePublicIp: string — Adopted gateway public ip of the site, only useful for cloud based controller and remote management local Controller
    - primary: boolean — Default Site mark
```

## GET /openapi/v1/{omadacId}/sites/{siteId}/devices

**Get site device list** — Get site device list.<br/><br/>The interface requires one of the permissions: <br/>Site Device Manager View Only<br/>MSP Device Manager View Only

Parameters:
- page (query, required): integer — Start page number. Start from 1.
- pageSize (query, required): integer — Number of entries per page. It should be within the range of 1–1000.
- sorts.name (query): string — Sort parameter may be one of asc or desc. Optional parameter. If it is not carried, it means it is not sorted by this field. When there are more than one, the first one takes effect
- sorts.status (query): string — Sort parameter may be one of asc or desc. Optional parameter. If it is not carried, it means it is not sorted by this field. When there are more than one, the first one takes effect
- sorts.ip (query): string — Sort parameter may be one of asc or desc. Optional parameter. If it is not carried, it means it is not sorted by this field. When there are more than one, the first one takes effect
- searchKey (query): string — Fuzzy query parameters, support field name,mac,ip
- filters.tag (query): string — Filter query parameters, support field tag name

Response 200:
```
- errorCode: integer
- msg: string
- result: object
  - totalRows: integer — Total rows of all items.
  - currentPage: integer — Current page number.
  - currentSize: integer — Number of entries per page.
  - data: array<DeviceInfo>
    - mac: string — Device MAC
    - name: string — Device name
    - type: string — Device type
    - subtype: string — Switch subtype should be a value as follows: smart: Non-Agile Series Switch; es: Agile Series Switch.
    - deviceSeriesType: integer — Device series type. 0 means basic, 1 means pro.
    - model: string — Device model name with version
    - modelName: string — Device model name
    - ip: string — Device IP
    - ipv6: array<string> — Device IPv6 list
    - uptime: string — Device uptime
    - status: integer — Device status should be a value as follows: 0: Disconnected; 1: Connected; 2: Pending; 3: Heartbeat Missed; 4: Isolated
    - detailStatus: integer — Status of device,status should be a value as follows: 0:Disconnected;1:Disconnected(Migrating);10:Provisioning;11:Configuring;12:Upgrading;13:Rebooting;14:Connected;15:Connected(Wireless);16:Connected(Migrating);17:Conne
    - modelVersion: string — Model version of device,for example:3.0
    - lastSeen: integer — Device lastSeen
    - cpuUtil: integer — Device cpuUtil
    - memUtil: integer — Device memUtil
    - sn: string — Device serial number
    - licenseStatus: integer — Device license status (Only for cloud base) should be a value as follows: 0: unActive; 1: Unbind; 2: Expired; 3: active
    - tagName: string — Device tag name
    - uplinkDeviceMac: string — Uplink device mac
    - uplinkDeviceName: string — Uplink device name
    - uplinkDevicePort: string — Uplink device port
    - linkSpeed: integer — Device uplink port linkSpeed, linkSpeed should be a value as follows: 0: Auto; 1: 10M; 2: 100M; 3: 1000M; 4: 2500M; 5: 10G; 6: 5G; 7: 25G, 8: 100G.
    - duplex: integer — Device uplink port duplex mode, duplex should be a value as follows: 0: Auto; 1: Half; 2: Full.
    - switchConsistent: boolean — Whether the device can be adopted by the site.
    - publicIp: string — Device public IP
    - firmwareVersion: string — The device firmware version.
    - compatible: integer — The compatible type of device.
    - active: boolean — Indicates whether the device is activated.
    - inWhiteList: boolean — Whether the device is in white list.
    - supportAfc: boolean — Whether the device supports AFC.
```
