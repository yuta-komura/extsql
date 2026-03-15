import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

public class MultiPrepareSample {
    public void test(Connection con) throws SQLException {
        StringBuilder sb1 = new StringBuilder();
        sb1.append(" SELECT ");
        sb1.append("   COL1 ");
        sb1.append(" FROM ");
        sb1.append("   TABLE1 ");

        PreparedStatement prepareStatement = con.prepareStatement(sb1.toString());

        StringBuilder sb2 = new StringBuilder();
        sb2.append(" UPDATE ");
        sb2.append("   TABLE1 ");
        sb2.append(" SET ");
        sb2.append("   COL1 = ? ");

        prepareStatement = con.prepareStatement(sb2.toString());
    }
}
