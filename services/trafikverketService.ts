const API_URL = process.env.TRAFIKVERKET_API_BASE_URL || 'https://api.trafikverket.se/v2/data.json';
const API_KEY = process.env.TRAFIKVERKET_API_KEY;

// We check this inside the functions instead of at top-level to prevent import-time crashes.

/**
 * Fetches data from the Trafikverket API using a specified query.
 * @param query - An XML string defining the data to be fetched.
 * @returns The JSON response from the API.
 * @throws {Error} If the fetch operation fails.
 */
export async function fetchTrafikverketData<T>(query: string): Promise<T> {
  if (!API_KEY) {
    throw new Error('Trafikverket API_KEY missing in environment variables.');
  }
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'Trafikverket-Api-Key': API_KEY,
      },
      body: query,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    // The actual data is nested in the response
    if (data.RESPONSE && data.RESPONSE.RESULT && data.RESPONSE.RESULT.length > 0) {
      return data.RESPONSE.RESULT[0] as T;
    }
    
    // Return empty array or object if no data is found, depending on expected response
    return {} as T;

  } catch (error) {
    console.error('Error fetching data from Trafikverket:', error);
    throw error;
  }
}

/**
 * Example query to fetch all railway stations.
 */
export const getAllTrainStationsQuery = `
<REQUEST>
  <LOGIN authenticationkey="${API_KEY}" />
  <QUERY objecttype="TrainStation" schemaversion="1">
    <FILTER />
  </QUERY>
</REQUEST>
`;
