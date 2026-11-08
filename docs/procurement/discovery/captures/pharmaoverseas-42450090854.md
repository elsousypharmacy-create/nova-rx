# Supplier discovery report — PharmaOverseas (logged in)

## Summary

- Source: offline sanitized capture (`nova-rx-discovery/1`); all header, cookie, query, and body values stripped.
- Endpoints observed: 21 (total calls: 68).
- Every endpoint below is marked `Observed` — seen in the capture, not confirmed as a stable, documented API.

## Endpoints

| Status | Method | Endpoint | Calls | Status codes | Query params |
| --- | --- | --- | --- | --- | --- |
| Observed | GET | `api.pharmaemarket.com/authorizationserver/csrf` | 2 | 200 | — |
| Observed | POST | `api.pharmaemarket.com/authorizationserver/oauth/token` | 1 | 200 | — |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/categories/Featured_Offers/products` | 1 | 200 | categoryId, curr, currentPage, fields, lang, pageSize |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/categories/New_Arrivals/products` | 1 | 200 | categoryId, curr, currentPage, fields, lang, pageSize |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/currencies` | 4 | 200 | curr, lang |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/customer/current/addresses` | 4 | 200 | curr, fields, lang |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/languages` | 4 | 200 | curr, lang |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/orgUsers/current` | 4 | 200 | curr, lang |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/products/{id}` | 2 | 200 | curr, fields, lang |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/products/{id}/references` | 2 | 200 | curr, fields, lang, referenceType |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/products/{id}/reviews` | 1 | 200 | curr, lang |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/products/search` | 2 | 200 | curr, currentPage, fields, lang, pageSize, query |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/users/anonymous/cms/pages` | 2 | 200 | curr, lang, pageLabelOrId, pageType |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/users/current/carts` | 2 | 200 | curr, fields, lang |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/users/current/carts/{id}` | 3 | 200 | curr, fields, lang |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/users/current/cms/components` | 16 | 200 | componentIds, curr, currentPage, fields, lang, pageSize, productCode |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/users/current/cms/pages` | 5 | 200 | code, curr, lang, pageLabelOrId, pageType |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/users/current/consenttemplates` | 1 | 200 | curr, lang |
| Observed | GET | `api.pharmaemarket.com/occ/v2/pharma/users/current/productinterests` | 4 | 200 | curr, fields, lang, pageSize, sort |
| Observed | GET | `firebase.googleapis.com/v1alpha/projects/-/apps/{id}/webConfig` | 6 | 200 | — |
| Observed | POST | `firebaseinstallations.googleapis.com/v1/projects/{id}/installations` | 1 | 200 | — |

## Login flow

- `GET api.pharmaemarket.com/authorizationserver/csrf` — request body fields: —.
- `POST api.pharmaemarket.com/authorizationserver/oauth/token` — request body fields: client_id, code, code_verifier, grant_type, redirect_uri.
- Credential values are intentionally absent from this report; only field names were kept.

## Response field map

### `GET api.pharmaemarket.com/authorizationserver/csrf`

- headerName: string
- parameterName: string
- token: string

### `POST api.pharmaemarket.com/authorizationserver/oauth/token`

- access_token: string
- refresh_token: string
- token_type: string
- expires_in: number

### `GET api.pharmaemarket.com/occ/v2/pharma/categories/Featured_Offers/products`

- type: string
- breadcrumbs: array
- categoryCode: string
- currentQuery: object
  - query: object
    - value: string
  - url: string
- facets: array of object
  - category: boolean
  - maxValue: number
  - minValue: number
  - multiSelect: boolean
  - name: string
  - priority: number
  - selectorType: string
  - visible: boolean
- freeTextSearch: string
- pagination: object
  - currentPage: number
  - pageSize: number
  - sort: string
  - totalPages: number
  - totalResults: number
- products: array of object
  - code: string
  - configurable: boolean
  - configuratorType: string
  - description: string
  - firstVariantImage: string
  - images: array of object
    - format: string
    - imageType: string
    - url: string
  - manufacturer: string
  - multidimensional: boolean
  - name: string
  - price: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - priceRange: object
  - publicPrice: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - stock: object
    - isValueRounded: boolean
    - stockLevelStatus: string
  - url: string
  - volumePricesFlag: boolean
- sorts: array of object
  - code: string
  - name: string
  - selected: boolean

### `GET api.pharmaemarket.com/occ/v2/pharma/categories/New_Arrivals/products`

- type: string
- breadcrumbs: array
- categoryCode: string
- currentQuery: object
  - query: object
    - value: string
  - url: string
- facets: array of object
  - category: boolean
  - multiSelect: boolean
  - name: string
  - priority: number
  - values: array of object
    - count: number
    - name: string
    - query: object
      - query: object
        - value: string
      - url: string
    - selected: boolean
  - visible: boolean
- freeTextSearch: string
- pagination: object
  - currentPage: number
  - pageSize: number
  - sort: string
  - totalPages: number
  - totalResults: number
- products: array of object
  - code: string
  - configurable: boolean
  - configuratorType: string
  - description: string
  - firstVariantImage: string
  - images: array of object
    - format: string
    - imageType: string
    - url: string
  - manufacturer: string
  - multidimensional: boolean
  - name: string
  - price: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - priceRange: object
  - publicPrice: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - stock: object
    - isValueRounded: boolean
    - stockLevelStatus: string
  - url: string
  - volumePricesFlag: boolean
- sorts: array of object
  - code: string
  - name: string
  - selected: boolean

### `GET api.pharmaemarket.com/occ/v2/pharma/currencies`

- currencies: array of object
  - active: boolean
  - isocode: string
  - name: string
  - symbol: string

### `GET api.pharmaemarket.com/occ/v2/pharma/customer/current/addresses`

- 0: object
  - active: boolean
  - uid: string
  - name: string
  - parentOrgUnit: null
  - approvalProcess: null
  - addresses: array of object
    - id: string
    - title: null
    - titleCode: null
    - firstName: null
    - lastName: null
    - companyName: null
    - line1: string
    - line2: null
    - town: string
    - region: object
      - isocode: string
      - isocodeShort: null
      - countryIso: null
      - name: null
    - district: null
    - postalCode: string
    - phone: string
    - cellphone: string
    - email: null
    - country: object
      - isocode: string
      - name: null
    - shippingAddress: null
    - defaultAddress: boolean
    - visibleInAddressBook: null
    - formattedAddress: string
  - approvers: null
  - managers: null
  - administrators: null
  - customers: array of object
    - uid: string
    - name: string
    - defaultAddress: object
      - id: string
      - title: null
      - titleCode: string
      - firstName: string
      - lastName: string
      - companyName: null
      - line1: string
      - line2: null
      - town: string
      - region: object
        - isocode: string
        - isocodeShort: null
        - countryIso: null
        - name: null
      - district: null
      - postalCode: null
      - phone: null
      - cellphone: string
      - email: null
      - country: object
        - isocode: string
        - name: null
      - shippingAddress: null
      - defaultAddress: boolean
      - visibleInAddressBook: null
      - formattedAddress: string
    - titleCode: string
    - title: string
    - firstName: string
    - lastName: string
    - currency: object
      - isocode: string
      - name: string
      - active: boolean
      - symbol: string
    - language: object
      - isocode: string
      - name: string
      - nativeName: string
      - active: boolean
    - displayUid: string
    - customerId: string
    - deactivationDate: null
    - defaultPointOfServiceName: null
    - lastCartId: null
    - hasOrder: null
    - userAvatar: null
    - orgUnit: object
      - active: boolean
      - uid: string
      - name: string
      - parentOrgUnit: null
      - approvalProcess: null
      - addresses: null
      - approvers: null
      - managers: null
      - administrators: null
      - customers: null
      - costCenters: null
    - roles: array of string
    - approvers: array
    - selected: boolean
    - active: boolean
    - email: string
    - mobileNumber: string
    - mobileNumberVerified: boolean
    - additionalPhoneNumber: string
    - organizationName: string
    - pharmacyCode: string
    - roleCode: string
    - role: string
    - organizationTypeCode: string
    - organizationType: string
    - paymentResponsibilityCode: string
    - paymentResponsibility: string
    - defaultB2BUnit: object
      - active: boolean
      - uid: string
      - name: string
      - parentOrgUnit: null
      - approvalProcess: null
      - addresses: null
      - approvers: null
      - managers: null
      - administrators: null
      - customers: null
      - costCenters: null
  - costCenters: array of object
    - originalCode: null
    - name: null
    - active: string
    - activeFlag: null
    - code: string
    - currency: object
      - isocode: string
      - name: null
      - active: null
      - symbol: null

### `GET api.pharmaemarket.com/occ/v2/pharma/languages`

- languages: array of object
  - active: boolean
  - isocode: string
  - name: string
  - nativeName: string

### `GET api.pharmaemarket.com/occ/v2/pharma/orgUsers/current`

- type: string
- name: string
- uid: string
- active: boolean
- additionalPhoneNumber: string
- approvers: array
- currency: object
  - active: boolean
  - isocode: string
  - name: string
  - symbol: string
- customerId: string
- defaultAddress: object
  - cellphone: string
  - country: object
    - isocode: string
  - defaultAddress: boolean
  - firstName: string
  - formattedAddress: string
  - id: string
  - lastName: string
  - line1: string
  - region: object
    - isocode: string
  - titleCode: string
  - town: string
- defaultB2BUnit: object
  - active: boolean
  - name: string
  - uid: string
- displayUid: string
- email: string
- firstName: string
- language: object
  - active: boolean
  - isocode: string
  - name: string
  - nativeName: string
- lastName: string
- mobileNumber: string
- mobileNumberVerified: boolean
- orgUnit: object
  - active: boolean
  - name: string
  - uid: string
- organizationName: string
- organizationType: string
- organizationTypeCode: string
- paymentResponsibility: string
- paymentResponsibilityCode: string
- pharmacyCode: string
- role: string
- roleCode: string
- roles: array of string
- selected: boolean
- title: string
- titleCode: string

### `GET api.pharmaemarket.com/occ/v2/pharma/products/{id}`

- baseOptions: array
- name: string
- purchasable: boolean
- availableForPickup: boolean
- categories: array of object
  - code: string
  - image: object
    - url: string
  - name: string
  - url: string
- code: string
- configurable: boolean
- description: string
- images: array of object
  - altText: string
  - format: string
  - imageType: string
  - url: string
- manufacturer: string
- multidimensional: boolean
- numberOfReviews: number
- pharmacyDiscount: object
  - absolute: boolean
  - appliedValue: number
  - code: string
  - value: number
- price: object
  - currencyIso: string
  - formattedValue: string
  - priceType: string
  - value: number
- priceRange: object
- publicPrice: object
  - currencyIso: string
  - formattedValue: string
  - priceType: string
  - value: number
- stock: object
  - isValueRounded: boolean
  - stockLevelStatus: string
- summary: string
- url: string

### `GET api.pharmaemarket.com/occ/v2/pharma/products/{id}/references`

- references: array

### `GET api.pharmaemarket.com/occ/v2/pharma/products/{id}/reviews`

- reviews: array

### `GET api.pharmaemarket.com/occ/v2/pharma/products/search`

- type: string
- breadcrumbs: array
- currentQuery: object
  - query: object
    - value: string
  - url: string
- facets: array of object
  - category: boolean
  - multiSelect: boolean
  - name: string
  - priority: number
  - values: array of object
    - count: number
    - name: string
    - query: object
      - query: object
        - value: string
      - url: string
    - selected: boolean
  - visible: boolean
- freeTextSearch: string
- pagination: object
  - currentPage: number
  - pageSize: number
  - sort: string
  - totalPages: number
  - totalResults: number
- products: array of object
  - code: string
  - configurable: boolean
  - configuratorType: string
  - images: array of object
    - format: string
    - imageType: string
    - url: string
  - multidimensional: boolean
  - name: string
  - price: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - priceRange: object
  - stock: object
    - isValueRounded: boolean
    - stockLevelStatus: string
- sorts: array of object
  - code: string
  - name: string
  - selected: boolean

### `GET api.pharmaemarket.com/occ/v2/pharma/users/anonymous/cms/pages`

- uid: string
- uuid: string
- title: string
- template: string
- typeCode: string
- name: string
- robotTag: string
- contentSlots: object
  - contentSlot: array of object
    - slotId: string
    - slotUuid: string
    - position: string
    - name: string
    - slotShared: boolean
    - components: object
      - component: array of object
        - uid: string
        - uuid: string
        - typeCode: string
        - modifiedtime: string
        - name: string
        - container: string
        - styleClasses: string
        - external: string
        - synchronizationBlocked: string
        - media: object
          - code: string
          - mime: string
          - url: string
        - urlLink: string
- label: string

### `GET api.pharmaemarket.com/occ/v2/pharma/users/current/carts`

- carts: array of object
  - appliedOrderPromotions: array
  - appliedProductPromotions: array
  - appliedVouchers: array
  - code: string
  - deliveryItemsQuantity: number
  - entries: array
  - guid: string
  - net: boolean
  - paymentType: object
    - code: string
  - pickupItemsQuantity: number
  - productDiscounts: object
    - formattedValue: string
  - subTotal: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - totalDiscounts: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - totalItems: number
  - totalPrice: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - totalPriceWithTax: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - totalProfitMargin: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - totalTax: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - description: string
  - name: string
  - potentialOrderPromotions: array
  - potentialProductPromotions: array
  - saveTime: string
  - totalUnitCount: number

### `GET api.pharmaemarket.com/occ/v2/pharma/users/current/carts/{id}`

- type: string
- appliedOrderPromotions: array
- appliedProductPromotions: array
- appliedVouchers: array
- code: string
- deliveryItemsQuantity: number
- entries: array of object
  - basePrice: object
    - formattedValue: string
    - value: number
  - cancellableQuantity: number
  - comments: array
  - configurationInfos: array
  - entryNumber: number
  - expiryDate: string
  - isReturnable: boolean
  - pharmacyDiscount: object
    - absolute: boolean
    - appliedValue: number
    - code: string
    - value: number
  - product: object
    - availableForPickup: boolean
    - baseOptions: array
    - categories: array of object
      - code: string
      - name: string
    - code: string
    - configurable: boolean
    - description: string
    - images: array of object
      - altText: string
      - format: string
      - imageType: string
      - url: string
    - manufacturer: string
    - name: string
    - pharmacyDiscount: object
      - absolute: boolean
      - appliedValue: number
      - code: string
      - value: number
    - publicPrice: object
      - currencyIso: string
      - formattedValue: string
      - priceType: string
      - value: number
    - purchasable: boolean
    - stock: object
      - isValueRounded: boolean
      - stockLevelStatus: string
    - taxValue: object
      - absolute: boolean
      - appliedValue: number
      - code: string
      - value: number
    - url: string
  - profitMargin: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - publicPrice: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - quantity: number
  - remainingDailyQuota: number
  - remainingMonthlyQuota: number
  - returnableQuantity: number
  - statusSummaryList: array
  - taxValue: object
    - absolute: boolean
    - appliedValue: number
    - code: string
    - value: number
  - totalPrice: object
    - currencyIso: string
    - formattedValue: string
    - value: number
  - totalProfitMargin: object
    - currencyIso: string
    - formattedValue: string
    - priceType: string
    - value: number
  - updateable: boolean
- guid: string
- net: boolean
- paymentType: object
  - code: string
- pickupItemsQuantity: number
- productDiscounts: object
  - formattedValue: string
- subTotal: object
  - currencyIso: string
  - formattedValue: string
  - priceType: string
  - value: number
- totalDiscounts: object
  - currencyIso: string
  - formattedValue: string
  - priceType: string
  - value: number
- totalItems: number
- totalPrice: object
  - currencyIso: string
  - formattedValue: string
  - priceType: string
  - value: number
- totalPriceWithTax: object
  - currencyIso: string
  - formattedValue: string
  - priceType: string
  - value: number
- totalProfitMargin: object
  - currencyIso: string
  - formattedValue: string
  - priceType: string
  - value: number
- totalTax: object
  - currencyIso: string
  - formattedValue: string
  - priceType: string
  - value: number
- user: object
  - name: string
  - uid: string
- potentialOrderPromotions: array
- potentialProductPromotions: array
- totalUnitCount: number

### `GET api.pharmaemarket.com/occ/v2/pharma/users/current/cms/components`

- component: array of object
  - uid: string
  - uuid: string
  - typeCode: string
  - modifiedtime: string
  - name: string
  - container: string
  - styleClasses: string
  - external: string
  - synchronizationBlocked: string
  - linkName: string
  - url: string
  - target: string
  - contentPage: string
  - contentPageLabelOrId: string
  - product: string
  - fullWidth: string
  - mobileIndex: string
  - media: object
    - tablet: object
      - code: string
      - mime: string
      - altText: string
      - url: string
    - desktop: object
      - code: string
      - mime: string
      - altText: string
      - url: string
    - widescreen: object
      - code: string
      - mime: string
      - altText: string
      - url: string
  - urlLink: string
  - parents: string
  - flexType: string
- pagination: object
  - count: number
  - hasNext: boolean
  - hasPrevious: boolean
  - page: number
  - totalCount: number
  - totalPages: number
- sorts: array

### `GET api.pharmaemarket.com/occ/v2/pharma/users/current/cms/pages`

- uid: string
- uuid: string
- title: string
- template: string
- typeCode: string
- name: string
- robotTag: string
- contentSlots: object
  - contentSlot: array of object
    - slotId: string
    - slotUuid: string
    - position: string
    - name: string
    - slotShared: boolean
    - components: object
      - component: array of object
        - uid: string
        - uuid: string
        - typeCode: string
        - modifiedtime: string
        - name: string
        - container: string
        - flexType: string
        - synchronizationBlocked: string
        - styleClasses: string
- label: string

### `GET api.pharmaemarket.com/occ/v2/pharma/users/current/consenttemplates`

- consentTemplates: array of object
  - description: string
  - id: string
  - name: string
  - version: number

### `GET api.pharmaemarket.com/occ/v2/pharma/users/current/productinterests`

- pagination: object
  - count: number
  - page: number
  - totalCount: number
  - totalPages: number
- results: array
- sorts: array of object
  - asc: boolean
  - code: string

### `GET firebase.googleapis.com/v1alpha/projects/-/apps/{id}/webConfig`

- projectId: string
- appId: string
- storageBucket: string
- authDomain: string
- messagingSenderId: string
- measurementId: string

### `POST firebaseinstallations.googleapis.com/v1/projects/{id}/installations`

- name: string
- fid: string
- refreshToken: string
- authToken: object
  - token: string
  - expiresIn: string

## Pagination

- `GET api.pharmaemarket.com/occ/v2/pharma/categories/Featured_Offers/products` — totalResults=5, totalPages=1, pageSize=100, currentPage=0, ?currentPage=, ?pageSize=
- `GET api.pharmaemarket.com/occ/v2/pharma/categories/New_Arrivals/products` — totalResults=14, totalPages=1, pageSize=100, currentPage=0, ?currentPage=, ?pageSize=
- `GET api.pharmaemarket.com/occ/v2/pharma/products/search` — totalResults=12, totalPages=1, pageSize=12, currentPage=0, ?currentPage=, ?pageSize=
- `GET api.pharmaemarket.com/occ/v2/pharma/users/current/cms/components` — totalPages=1, ?currentPage=, ?pageSize=
- `GET api.pharmaemarket.com/occ/v2/pharma/users/current/productinterests` — totalPages=0, ?pageSize=

## Price fields

- `GET api.pharmaemarket.com/occ/v2/pharma/categories/Featured_Offers/products` — value=84.21, formattedValue=EGP84.210, currencyIso=EGP
- `GET api.pharmaemarket.com/occ/v2/pharma/categories/New_Arrivals/products` — value=318.98, formattedValue=EGP318.980, currencyIso=EGP
- `GET api.pharmaemarket.com/occ/v2/pharma/products/{id}` — value=25, formattedValue=EGP33.750, currencyIso=EGP, appliedValue=12.75
- `GET api.pharmaemarket.com/occ/v2/pharma/products/search` — value=33.75, formattedValue=EGP33.750, currencyIso=EGP
- `GET api.pharmaemarket.com/occ/v2/pharma/users/current/carts` — value=0, formattedValue=EGP0.000, currencyIso=EGP, appliedValue=39
- `GET api.pharmaemarket.com/occ/v2/pharma/users/current/carts/{id}` — value=136.84, formattedValue=EGP136.840, currencyIso=EGP, appliedValue=39

## Stock fields

- `GET api.pharmaemarket.com/occ/v2/pharma/categories/Featured_Offers/products` — stockLevelStatus=inStock
- `GET api.pharmaemarket.com/occ/v2/pharma/categories/New_Arrivals/products` — stockLevelStatus=inStock
- `GET api.pharmaemarket.com/occ/v2/pharma/products/{id}` — stockLevelStatus=inStock
- `GET api.pharmaemarket.com/occ/v2/pharma/products/search` — stockLevelStatus=inStock
- `GET api.pharmaemarket.com/occ/v2/pharma/users/current/carts` — stockLevelStatus=inStock
- `GET api.pharmaemarket.com/occ/v2/pharma/users/current/carts/{id}` — stockLevelStatus=inStock

## Cart

- `GET api.pharmaemarket.com/occ/v2/pharma/users/current/carts` — 2 call(s), status 200
- `GET api.pharmaemarket.com/occ/v2/pharma/users/current/carts/{id}` — 3 call(s), status 200

## Open questions

- Which login variant (form vs JSON body) does the live site actually use, and are extra hidden fields required?
- What does each `{id}` path parameter represent (product code, internal id), and what is its exact format?
- What are the real pagination parameter names, defaults, and maximum page size?
- Which observed price field is the sell price versus list/discount price?
- Which stock status values exist beyond those observed in the capture?

