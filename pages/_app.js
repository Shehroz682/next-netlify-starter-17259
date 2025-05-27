import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';

// Define global variables for Firebase configuration (provided by Canvas environment)
// Ensure these are defined before initializing Firebase
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Main App component for Electricity Load Calculator and Solar Quotation
const App = () => {
  // Firebase state
  const [firebaseApp, setFirebaseApp] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // State to manage the list of appliances
  const [appliances, setAppliances] = useState([
    { id: 1, name: 'Lights (LED)', wattage: 10, hoursPerDay: 6, quantity: 10 },
    { id: 2, name: 'TV', wattage: 100, hoursPerDay: 4, quantity: 1 },
    { id: 3, name: 'Refrigerator', wattage: 150, hoursPerDay: 24, quantity: 1 },
    { id: 4, name: 'AC Unit (Large)', wattage: 3000, hoursPerDay: 8, quantity: 1 },
  ]);

  // State for calculated results
  const [totalDailyKWh, setTotalDailyKWh] = useState(0);
  const [estimatedSystemSizeKW, setEstimatedSystemSizeKW] = useState(0);
  const [estimatedSystemCostSAR, setEstimatedSystemCostSAR] = useState(0);
  const [estimatedMonthlySavingsSAR, setEstimatedMonthlySavingsSAR] = useState(0);
  const [calculationError, setCalculationError] = useState('');

  // State for quote request form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [formSubmissionMessage, setFormSubmissionMessage] = useState('');

  // State for LLM suggestions
  const [suggestedAppliances, setSuggestedAppliances] = useState([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');

  // State for energy saving tips
  const [energySavingTips, setEnergySavingTips] = useState('');
  const [isGeneratingTips, setIsGeneratingTips] = useState(false);
  const [tipsError, setTipsError] = useState('');


  // Constants for solar calculation (simplified assumptions)
  const AVERAGE_PEAK_SUN_HOURS_PER_DAY = 5; // Average for many regions
  const SYSTEM_EFFICIENCY_FACTOR = 0.8; // Accounts for losses
  const COST_PER_WATT_SAR = 11.25; // Approx $3.0 USD/watt * 3.75 SAR/USD
  const AVERAGE_ELECTRICITY_TARIFF_SAR_PER_KWH = 0.18; // Rough estimate for residential in KSA
  const SAVINGS_PERCENTAGE = 0.85; // Assume 85% of bill can be offset

  // Initialize Firebase and handle authentication
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const authInstance = getAuth(app);
      setFirebaseApp(app);
      setAuth(authInstance);

      const signIn = async () => {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(authInstance, initialAuthToken);
          } else {
            await signInAnonymously(authInstance);
          }
          setUserId(authInstance.currentUser?.uid || crypto.randomUUID());
          setIsAuthReady(true);
        } catch (error) {
          console.error("Firebase authentication error:", error);
          setIsAuthReady(true); // Still set ready even if auth fails, to allow app to load
        }
      };
      signIn();
    } catch (error) {
      console.error("Firebase initialization error:", error);
      setIsAuthReady(true); // Still set ready even if init fails
    }
  }, []);

  // Effect to recalculate whenever appliances change
  useEffect(() => {
    calculateLoadAndQuote();
  }, [appliances]);

  /**
   * Adds a new empty appliance row to the list.
   */
  const addApplianceRow = () => {
    setAppliances([
      ...appliances,
      { id: Date.now(), name: '', wattage: '', hoursPerDay: '', quantity: '' },
    ]);
  };

  /**
   * Adds a suggested appliance to the main list.
   * @param {object} suggestedApp - The suggested appliance object.
   */
  const addSuggestedAppliance = (suggestedApp) => {
    // Check if appliance with same name already exists to prevent duplicates
    const exists = appliances.some(app => app.name.toLowerCase() === suggestedApp.name.toLowerCase());
    if (!exists) {
      setAppliances([
        ...appliances,
        {
          id: Date.now(),
          name: suggestedApp.name,
          wattage: suggestedApp.wattage,
          hoursPerDay: suggestedApp.hoursPerDay,
          quantity: 1, // Default quantity to 1 for suggested items
        },
      ]);
    }
    // Clear suggestions after adding one
    setSuggestedAppliances([]);
  };

  /**
   * Updates an appliance's properties based on input changes.
   * @param {number} id - The ID of the appliance to update.
   * @param {string} field - The field to update (e.g., 'name', 'wattage').
   * @param {string} value - The new value for the field.
   */
  const handleApplianceChange = (id, field, value) => {
    setAppliances(
      appliances.map((app) =>
        app.id === id ? { ...app, [field]: field === 'name' ? value : parseFloat(value) || '' } : app
      )
    );
  };

  /**
   * Removes an appliance row from the list.
   * @param {number} id - The ID of the appliance to remove.
   */
  const removeApplianceRow = (id) => {
    setAppliances(appliances.filter((app) => app.id !== id));
  };

  /**
   * Calculates the total electricity load, estimated system size, cost, and savings.
   */
  const calculateLoadAndQuote = () => {
    setCalculationError(''); // Clear previous errors
    let dailyKWhSum = 0;

    // Validate inputs and calculate daily kWh for each appliance
    for (const app of appliances) {
      if (
        !app.name ||
        isNaN(app.wattage) ||
        app.wattage <= 0 ||
        isNaN(app.hoursPerDay) ||
        app.hoursPerDay < 0 ||
        isNaN(app.quantity) ||
        app.quantity <= 0
      ) {
        setCalculationError('Please ensure all appliance fields are filled correctly with positive numbers.');
        setTotalDailyKWh(0);
        setEstimatedSystemSizeKW(0);
        setEstimatedSystemCostSAR(0);
        setEstimatedMonthlySavingsSAR(0);
        return;
      }
      // Calculate daily kWh for one instance of the appliance
      const dailyKWhPerAppliance = (app.wattage * app.hoursPerDay * app.quantity) / 1000;
      dailyKWhSum += dailyKWhPerAppliance;
    }

    setTotalDailyKWh(dailyKWhSum);

    // 1. Estimate System Size (kW)
    // Formula: (Total Daily kWh / (Peak Sun Hours * System Efficiency))
    const systemSizeKW = dailyKWhSum / (AVERAGE_PEAK_SUN_HOURS_PER_DAY * SYSTEM_EFFICIENCY_FACTOR);
    setEstimatedSystemSizeKW(systemSizeKW);

    // 2. Estimate System Cost (SAR)
    // Formula: System Size (kW) * Cost per Watt (SAR) * 1000 (to convert kW to W)
    const systemCostSAR = systemSizeKW * COST_PER_WATT_SAR * 1000;
    setEstimatedSystemCostSAR(systemCostSAR);

    // 3. Estimate Monthly Savings (SAR)
    // Assume average monthly consumption is totalDailyKWh * 30.4 (average days in month)
    const estimatedMonthlyConsumptionKWh = dailyKWhSum * 30.4;
    const estimatedMonthlyBill = estimatedMonthlyConsumptionKWh * AVERAGE_ELECTRICITY_TARIFF_SAR_PER_KWH;
    const monthlySavings = estimatedMonthlyBill * SAVINGS_PERCENTAGE;
    setEstimatedMonthlySavingsSAR(monthlySavings);
  };

  /**
   * Handles the submission of the detailed quote request form.
   * In a real application, this would send data to a backend server.
   */
  const requestDetailedQuote = (e) => {
    e.preventDefault();
    setFormSubmissionMessage('');

    // Basic form validation
    if (!name || !email || !phone || !location) {
      setFormSubmissionMessage('Please fill in all fields (Name, Email, Phone, Location).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormSubmissionMessage('Please enter a valid email address.');
      return;
    }
    if (!/^\+?[0-9\s-()]{7,20}$/.test(phone)) {
      setFormSubmissionMessage('Please enter a valid phone number.');
      return;
    }

    // Simulate API call to send data
    console.log('Detailed Quote Request Submitted:', {
      name,
      email,
      phone,
      location,
      totalDailyKWh,
      estimatedSystemSizeKW,
      estimatedSystemCostSAR,
      estimatedMonthlySavingsSAR,
      appliances,
    });

    setFormSubmissionMessage('Thank you for your detailed request! We will contact you shortly.');

    // Optionally clear form fields after submission
    setName('');
    setEmail('');
    setPhone('');
    setLocation('');
  };

  /**
   * Calls the Gemini API to suggest more appliances based on the current list.
   */
  const suggestMoreAppliances = async () => {
    setIsSuggesting(true);
    setSuggestionError('');
    setSuggestedAppliances([]);

    const currentApplianceNames = appliances.map(app => app.name).join(', ');
    const prompt = `Given the following list of appliances in a household: ${currentApplianceNames}. Suggest 3-5 other common household appliances that might be missing, along with their typical wattage (W) and average hours used per day. Provide the response as a JSON array of objects, where each object has 'name' (string), 'wattage' (number), and 'hoursPerDay' (number) keys. Ensure the suggested appliances are distinct from the provided list.`;

    let chatHistory = [];
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });

    const payload = {
      contents: chatHistory,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              "name": { "type": "STRING" },
              "wattage": { "type": "NUMBER" },
              "hoursPerDay": { "type": "NUMBER" }
            },
            propertyOrdering: ["name", "wattage", "hoursPerDay"]
          }
        }
      }
    };

    const apiKey = ""; // Canvas will automatically provide the API key
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        const jsonString = result.candidates[0].content.parts[0].text;
        const parsedSuggestions = JSON.parse(jsonString);

        // Filter out suggestions that are already in the current appliances list
        const filteredSuggestions = parsedSuggestions.filter(suggestedApp =>
          !appliances.some(existingApp => existingApp.name.toLowerCase() === suggestedApp.name.toLowerCase())
        );

        setSuggestedAppliances(filteredSuggestions);
      } else {
        setSuggestionError('Could not get suggestions. Please try again.');
      }
    } catch (error) {
      console.error("Error fetching appliance suggestions:", error);
      setSuggestionError('Failed to fetch suggestions. Please check your network connection.');
    } finally {
      setIsSuggesting(false);
    }
  };

  /**
   * Calls the Gemini API to generate energy-saving tips based on the current appliance list.
   */
  const handleGetEnergySavingTips = async () => {
    setIsGeneratingTips(true);
    setTipsError('');
    setEnergySavingTips('');

    const applianceListText = appliances.map(app => `${app.name} (${app.wattage}W, ${app.hoursPerDay} hours/day, ${app.quantity} quantity)`).join('; ');
    const prompt = `Given the following list of household appliances and their usage: ${applianceListText}. Provide 3-5 concise and actionable energy-saving tips specifically tailored to reduce the electricity consumption related to these types of appliances. Focus on practical advice.`;

    let chatHistory = [];
    chatHistory.push({ role: "user", parts: [{ text: prompt }] });

    const payload = {
      contents: chatHistory,
      generationConfig: {
        responseMimeType: "text/plain", // Request plain text for tips
      }
    };

    const apiKey = ""; // Canvas will automatically provide the API key
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.candidates && result.candidates.length > 0 &&
          result.candidates[0].content && result.candidates[0].content.parts &&
          result.candidates[0].content.parts.length > 0) {
        setEnergySavingTips(result.candidates[0].content.parts[0].text);
      } else {
        setTipsError('Could not generate energy-saving tips. Please try again.');
      }
    } catch (error) {
      console.error("Error generating energy saving tips:", error);
      setTipsError('Failed to generate tips. Please check your network connection.');
    } finally {
      setIsGeneratingTips(false);
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 to-green-100 flex items-center justify-center p-4 font-inter">
      <div className="bg-white rounded-xl shadow-2xl p-8 md:p-10 w-full max-w-2xl">
        <h1 className="text-3xl md:text-4xl font-bold text-center text-gray-800 mb-6">
          <span className="text-yellow-500">EverSolar</span> Energy Calculator
        </h1>
        <p className="text-center text-gray-600 mb-8">
          Estimate your home's electricity load and get a preliminary solar quotation.
        </p>

        {/* Appliance Input Section */}
        <div className="mb-8 p-6 bg-gray-50 rounded-lg shadow-inner">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4 text-center">Your Appliances</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm font-medium text-gray-700 mb-3 px-2">
            <span className="col-span-1 md:col-span-1">Appliance Name</span>
            <span>Wattage (W)</span>
            <span>Hours/Day</span>
            <span>Quantity</span>
          </div>
          {appliances.map((app) => (
            <div key={app.id} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-3 items-center">
              <input
                type="text"
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-400"
                placeholder="e.g., Laptop"
                value={app.name}
                onChange={(e) => handleApplianceChange(app.id, 'name', e.target.value)}
                aria-label={`Appliance Name for ${app.name}`}
              />
              <input
                type="number"
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-400"
                placeholder="e.g., 60"
                value={app.wattage}
                onChange={(e) => handleApplianceChange(app.id, 'wattage', e.target.value)}
                aria-label={`Wattage for ${app.name}`}
              />
              <input
                type="number"
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-400"
                placeholder="e.g., 8"
                value={app.hoursPerDay}
                onChange={(e) => handleApplianceChange(app.id, 'hoursPerDay', e.target.value)}
                aria-label={`Hours per day for ${app.name}`}
              />
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-400"
                  placeholder="e.g., 1"
                  value={app.quantity}
                  onChange={(e) => handleApplianceChange(app.id, 'quantity', e.target.value)}
                  aria-label={`Quantity for ${app.name}`}
                />
                <button
                  onClick={() => removeApplianceRow(app.id)}
                  className="bg-red-500 text-white p-2 rounded-full hover:bg-red-600 transition duration-200"
                  aria-label={`Remove ${app.name}`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={addApplianceRow}
            className="w-full bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-blue-600 transition duration-300 ease-in-out mt-4"
            aria-label="Add Another Appliance"
          >
            Add Another Appliance
          </button>
          <button
            onClick={suggestMoreAppliances}
            className="w-full bg-purple-500 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-purple-600 transition duration-300 ease-in-out mt-4 flex items-center justify-center"
            disabled={isSuggesting}
            aria-label="Suggest More Appliances"
          >
            {isSuggesting ? (
              <svg className="animate-spin h-5 w-5 text-white mr-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              '✨ Suggest Appliances'
            )}
          </button>
          {suggestionError && (
            <p className="text-red-600 text-sm mt-4 text-center">{suggestionError}</p>
          )}

          {suggestedAppliances.length > 0 && (
            <div className="mt-6 p-4 bg-yellow-100 rounded-lg shadow-inner">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Suggested Appliances:</h3>
              <div className="space-y-2">
                {suggestedAppliances.map((suggApp, index) => (
                  <div key={index} className="flex justify-between items-center bg-yellow-50 p-2 rounded-lg">
                    <span className="text-gray-700">
                      {suggApp.name} ({suggApp.wattage}W, {suggApp.hoursPerDay}h/day)
                    </span>
                    <button
                      onClick={() => addSuggestedAppliance(suggApp)}
                      className="bg-green-500 text-white text-xs px-3 py-1 rounded-full hover:bg-green-600 transition duration-200"
                      aria-label={`Add ${suggApp.name}`}
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleGetEnergySavingTips}
            className="w-full bg-indigo-500 text-white font-semibold py-2 px-4 rounded-lg shadow-md hover:bg-indigo-600 transition duration-300 ease-in-out mt-4 flex items-center justify-center"
            disabled={isGeneratingTips}
            aria-label="Get Energy Saving Tips"
          >
            {isGeneratingTips ? (
              <svg className="animate-spin h-5 w-5 text-white mr-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              '✨ Get Energy Saving Tips'
            )}
          </button>
          {tipsError && (
            <p className="text-red-600 text-sm mt-4 text-center">{tipsError}</p>
          )}

          {energySavingTips && (
            <div className="mt-6 p-4 bg-blue-100 rounded-lg shadow-inner">
              <h3 className="text-lg font-semibold text-gray-800 mb-3">Your Personalized Energy Saving Tips:</h3>
              <div className="prose prose-sm max-w-none text-gray-700">
                {energySavingTips.split('\n').map((tip, index) => (
                  <p key={index}>{tip}</p>
                ))}
              </div>
            </div>
          )}

          {calculationError && (
            <p className="text-red-600 text-sm mt-4 text-center">{calculationError}</p>
          )}
        </div>

        {/* Results Section */}
        <div className="bg-yellow-50 p-6 rounded-lg shadow-inner mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4 text-center">Your Solar Estimate</h2>
          <div className="space-y-3 text-gray-700">
            <p className="text-lg">
              Estimated Daily Energy Consumption:{' '}
              <span className="font-bold text-green-700">
                {totalDailyKWh.toFixed(2)} kWh
              </span>
            </p>
            <p className="text-lg">
              Recommended Solar System Size:{' '}
              <span className="font-bold text-green-700">
                {estimatedSystemSizeKW.toFixed(2)} kW
              </span>
            </p>
            <p className="text-lg">
              Estimated System Cost:{' '}
              <span className="font-bold text-green-700">
                SAR {estimatedSystemCostSAR.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </p>
            <p className="text-lg">
              Estimated Monthly Savings:{' '}
              <span className="font-bold text-green-700">
                SAR {estimatedMonthlySavingsSAR.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </p>
          </div>
          <p className="text-sm text-gray-600 mt-4 text-center">
            *These are preliminary estimates based on simplified assumptions. Actual costs and savings can vary significantly based on your specific location, roof characteristics, local incentives, and energy consumption patterns.
          </p>
        </div>

        {/* Detailed Quote Request Form */}
        <form onSubmit={requestDetailedQuote} className="bg-blue-50 p-6 rounded-lg shadow-inner">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4 text-center">Get a Detailed Quote</h2>
          <p className="text-center text-gray-600 mb-6">
            Fill out the form below for a personalized consultation and precise quotation from our experts.
          </p>
          <div className="space-y-4">
            <div>
              <label htmlFor="quoteName" className="block text-gray-700 text-sm font-medium mb-2">
                Name
              </label>
              <input
                type="text"
                id="quoteName"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition duration-200"
                placeholder="Your Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-label="Your Name for Quote Request"
              />
            </div>
            <div>
              <label htmlFor="quoteEmail" className="block text-gray-700 text-sm font-medium mb-2">
                Email
              </label>
              <input
                type="email"
                id="quoteEmail"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition duration-200"
                placeholder="your.email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Your Email for Quote Request"
              />
            </div>
            <div>
              <label htmlFor="quotePhone" className="block text-gray-700 text-sm font-medium mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                id="quotePhone"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition duration-200"
                placeholder="e.g., +966 50 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                aria-label="Your Phone Number for Quote Request"
              />
            </div>
            <div>
              <label htmlFor="quoteLocation" className="block text-gray-700 text-sm font-medium mb-2">
                Your City / Location
              </label>
              <input
                type="text"
                id="quoteLocation"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition duration-200"
                placeholder="e.g., Riyadh"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                aria-label="Your City or Location for Quote Request"
              />
            </div>

            {formSubmissionMessage && (
              <p className={`text-sm mt-2 text-center ${formSubmissionMessage.includes('Thank you') ? 'text-green-600' : 'text-red-600'}`}>
                {formSubmissionMessage}
              </p>
            )}

            <button
              type="submit"
              className="w-full bg-green-500 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:bg-green-600 transition duration-300 ease-in-out transform hover:scale-105"
              aria-label="Submit Detailed Quote Request"
            >
              Get My Detailed Quote
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default App;
