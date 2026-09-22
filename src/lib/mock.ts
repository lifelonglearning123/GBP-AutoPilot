/**
 * Fixtures for mock mode. Shaped exactly like the real API responses so the sync, audit, review
 * and post code paths run unchanged. `_account` / `_location` are mock-only join keys.
 */
export const MOCK_ACCOUNTS = [
  { name: 'accounts/100000000000000001', accountName: 'Macaws Agency', type: 'LOCATION_GROUP' },
];

export const MOCK_LOCATIONS: any[] = [
  {
    _account: 'accounts/100000000000000001',
    name: 'locations/200000000000000001',
    title: 'Bright Spark Electrical',
    languageCode: 'en-GB',
    storeCode: 'BSE-STA',
    phoneNumbers: { primaryPhone: '01727 000000' },
    websiteUri: 'https://brightsparkelectrical.example',
    storefrontAddress: {
      regionCode: 'GB', postalCode: 'AL1 3AA', locality: 'St Albans', administrativeArea: 'Hertfordshire',
      addressLines: ['12 Holywell Hill'],
    },
    latlng: { latitude: 51.7497, longitude: -0.3387 },
    regularHours: {
      periods: [
        { openDay: 'MONDAY', openTime: { hours: 8 }, closeDay: 'MONDAY', closeTime: { hours: 18 } },
        { openDay: 'TUESDAY', openTime: { hours: 8 }, closeDay: 'TUESDAY', closeTime: { hours: 18 } },
        { openDay: 'WEDNESDAY', openTime: { hours: 8 }, closeDay: 'WEDNESDAY', closeTime: { hours: 18 } },
        { openDay: 'THURSDAY', openTime: { hours: 8 }, closeDay: 'THURSDAY', closeTime: { hours: 18 } },
        { openDay: 'FRIDAY', openTime: { hours: 8 }, closeDay: 'FRIDAY', closeTime: { hours: 17 } },
      ],
    },
    categories: {
      primaryCategory: { name: 'categories/gcid:electrician', displayName: 'Electrician' },
      additionalCategories: [],
    },
    serviceItems: [
      { freeFormServiceItem: { category: 'categories/gcid:electrician', label: { displayName: 'Rewiring', languageCode: 'en-GB' } } },
    ],
    profile: { description: '' },
    labels: [],
    openInfo: { status: 'OPEN' },
    metadata: {
      mapsUri: 'https://maps.google.com/?cid=1234567890',
      newReviewUri: 'https://search.google.com/local/writereview?placeid=ChIJmock',
      placeId: 'ChIJmock',
      hasGoogleUpdated: false,
    },
  },
  {
    _account: 'accounts/100000000000000001',
    name: 'locations/200000000000000002',
    title: 'Riverside Dental Care',
    languageCode: 'en-GB',
    phoneNumbers: { primaryPhone: '01234 567890' },
    websiteUri: '',
    storefrontAddress: { regionCode: 'GB', postalCode: 'MK40 1AA', locality: 'Bedford', addressLines: ['5 River Street'] },
    latlng: { latitude: 52.1362, longitude: -0.4667 },
    regularHours: { periods: [] },
    categories: { primaryCategory: { name: 'categories/gcid:dentist', displayName: 'Dentist' } },
    serviceItems: [],
    profile: { description: 'Family dentist in Bedford.' },
    openInfo: { status: 'OPEN' },
    metadata: { mapsUri: 'https://maps.google.com/?cid=222', placeId: 'ChIJmock2' },
  },
];

export const MOCK_CATEGORIES = [
  { name: 'categories/gcid:electrician', displayName: 'Electrician' },
  { name: 'categories/gcid:electrical_installation_service', displayName: 'Electrical installation service' },
  { name: 'categories/gcid:electrical_repair_shop', displayName: 'Electrical repair shop' },
  { name: 'categories/gcid:electric_vehicle_charging_station_contractor', displayName: 'Electric vehicle charging station contractor' },
  { name: 'categories/gcid:lighting_contractor', displayName: 'Lighting contractor' },
  { name: 'categories/gcid:emergency_electrician', displayName: 'Emergency electrician' },
  { name: 'categories/gcid:dentist', displayName: 'Dentist' },
  { name: 'categories/gcid:cosmetic_dentist', displayName: 'Cosmetic dentist' },
  { name: 'categories/gcid:dental_clinic', displayName: 'Dental clinic' },
  { name: 'categories/gcid:emergency_dental_service', displayName: 'Emergency dental service' },
  { name: 'categories/gcid:teeth_whitening_service', displayName: 'Teeth whitening service' },
  { name: 'categories/gcid:dental_hygienist', displayName: 'Dental hygienist' },
  { name: 'categories/gcid:plumber', displayName: 'Plumber' },
  { name: 'categories/gcid:roofing_contractor', displayName: 'Roofing contractor' },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export const MOCK_REVIEWS: any[] = [
  { _location: 'locations/200000000000000001', reviewId: 'r1', reviewer: { displayName: 'Sarah M' }, starRating: 'FIVE',
    comment: 'Dan rewired our whole kitchen in St Albans in two days, tidy and on budget. Highly recommend.', createTime: daysAgo(2), updateTime: daysAgo(2) },
  { _location: 'locations/200000000000000001', reviewId: 'r2', reviewer: { displayName: 'Tom H' }, starRating: 'FOUR',
    comment: 'Fitted an EV charger. Good work, took a while to get a booking though.', createTime: daysAgo(5), updateTime: daysAgo(5) },
  { _location: 'locations/200000000000000001', reviewId: 'r3', reviewer: { displayName: 'Anon', isAnonymous: true }, starRating: 'TWO',
    comment: 'Turned up late and left mess.', createTime: daysAgo(9), updateTime: daysAgo(9) },
  { _location: 'locations/200000000000000001', reviewId: 'r4', reviewer: { displayName: 'Priya K' }, starRating: 'FIVE',
    comment: 'Emergency call out on a Sunday, sorted the fuse board in an hour.', createTime: daysAgo(30), updateTime: daysAgo(30),
    reviewReply: { comment: 'Thanks Priya, glad we could help.', updateTime: daysAgo(29) } },
  { _location: 'locations/200000000000000001', reviewId: 'r5', reviewer: { displayName: 'Mark R' }, starRating: 'FIVE',
    comment: '', createTime: daysAgo(40), updateTime: daysAgo(40) },
  { _location: 'locations/200000000000000002', reviewId: 'r6', reviewer: { displayName: 'Lucy B' }, starRating: 'FIVE',
    comment: 'Gentle hygienist, no waiting. Best dentist in Bedford.', createTime: daysAgo(1), updateTime: daysAgo(1) },
];

/** Pages the citation audit "finds" in mock mode: one clean, one stale phone, one old address, one not listed. */
export const MOCK_CITATION_PAGES: Record<string, { title: string; text: string }> = {
  'https://brightsparkelectrical.example/contact': {
    title: 'Contact | Bright Spark Electrical',
    text: 'Bright Spark Electrical\nContact us\n12 Holywell Hill, St Albans, Hertfordshire AL1 3AA\nCall 01727 000000\nOpen Monday to Friday 8am to 6pm',
  },
  'https://www.yell.com/biz/bright-spark-electrical-st-albans-1234': {
    title: 'Bright Spark Electrical, St Albans | Electricians - Yell',
    text: 'Bright Spark Electrical Ltd\nElectricians in St Albans\n12 Holywell Hill, St Albans, AL1 3AA\nTel 01727 999999\nClaimed listing\nOther electricians nearby: Volt Bros 01727 111111 AL3 4RR',
  },
  'https://www.thomsonlocal.com/electricians/st-albans/bright-spark': {
    title: 'Bright Spark Electrical - Thomson Local',
    text: 'Bright Spark Electrical\n4 Market Place, St Albans AL3 5DG\n01727 000000\nCategories: Electricians, Electrical contractors',
  },
  'https://www.cylex-uk.co.uk/company/bright-spark-electrical-99.html': {
    title: 'Bright Spark Electrical, St Albans - Cylex',
    text: 'Bright Spark Electrical\nHolywell Hill 12, St Albans AL1 3AA\nPhone: +44 1727 000000\nWebsite: brightsparkelectrical.example',
  },
  'https://www.facebook.com/brightsparkelectricalstalbans': {
    title: 'Bright Spark Electrical | St Albans | Facebook',
    text: 'Bright Spark Electrical. 312 likes. Local electricians covering St Albans and Harpenden. Message us for a quote.',
  },
  'https://www.scoot.co.uk/electricians/st-albans': {
    title: 'Electricians in St Albans - Scoot',
    text: 'Electricians in St Albans\nVolt Bros 01727 111111\nAmp It Up Electrical 01727 222222\nSparkline 01727 333333',
  },
};
