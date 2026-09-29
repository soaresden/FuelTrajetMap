package fr.soaresden.fuelmap.auto;

/** Une station avec le prix du carburant demandé. */
public class Station {
    public String id, brand = "", ville = "", adresse = "";
    public double lat, lon, price, distKm;
    public boolean auto24;
    public int ageDays;
}
